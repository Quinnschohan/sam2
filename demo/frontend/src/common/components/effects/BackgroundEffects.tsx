/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {backgroundEffects} from '@/common/components/effects/EffectsUtils';
import EffectVariantBadge from '@/common/components/effects/EffectVariantBadge';
import ToolbarActionIcon from '@/common/components/toolbar/ToolbarActionIcon';
import ToolbarSection from '@/common/components/toolbar/ToolbarSection';
import useVideoEffect from '@/common/components/video/editor/useVideoEffect';
import {EffectIndex} from '@/common/components/video/effects/Effects';
import {activeBackgroundEffectAtom} from '@/demo/atoms';
import {useAtomValue} from 'jotai';
import {useCallback} from 'react';
import useVideo from '@/common/components/video/editor/useVideo';
import type { SetBackgroundVideoFramesRequest } from '@/common/components/video/VideoWorkerTypes';
import BackgroundVideoControl from './BackgroundVideoControl';

// Define the structure for frames with timestamps
type TimestampedFrame = { timestamp: number; bitmap: ImageBitmap };

// Restore the correct frame extraction function
async function extractFramesFromFile(file: File): Promise<TimestampedFrame[]> {
  console.log('[MainThread] Starting extractFramesFromFile (<video> rAF method)...');
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const frames: TimestampedFrame[] = [];
  const objectUrl = URL.createObjectURL(file);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let frameRequestCallbackId: number | null = null; 

  if (!ctx) {
    URL.revokeObjectURL(objectUrl); // Clean up URL if context fails early
    throw new Error('Failed to get 2D context from canvas');
  }

  // Overall timeout for the extraction process
  const operationTimeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Frame extraction operation timed out (120s)')); 
    }, 120000); // 120 second overall timeout
  });

  try {
    const loadPromise = new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          console.log('[MainThread] video.onloadedmetadata fired.');
          resolve();
        };
        video.onerror = (e) => reject(new Error(`Video loading error: ${video.error?.message || 'Unknown error'}`));

        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto'; // Hint browser to load metadata
        video.src = objectUrl;
        video.load(); // Explicitly call load
        console.log('[MainThread] video.load() called.');
    });

    // Wait for metadata or the overall timeout
    await Promise.race([loadPromise, operationTimeoutPromise]);

    console.log(`[MainThread] Video metadata loaded. ReadyState: ${video.readyState}`);

    // Check for valid dimensions and duration
    if (!video.videoWidth || !video.videoHeight || !video.duration || video.duration === Infinity || isNaN(video.duration)) {
       console.error('[MainThread] Invalid video metadata:', {
           width: video.videoWidth,
           height: video.videoHeight,
           duration: video.duration,
           readyState: video.readyState,
           error: video.error
       });
       throw new Error('Failed to get valid video metadata (dimensions/duration).');
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // --- Frame Extraction using requestAnimationFrame --- START ---
    const TARGET_FRAMES = 200; 
    const framesPerSecond = 10; // Keep slightly lower FPS threshold
    let lastCapturedTime = -1; // Track time to avoid duplicate frames
    const timeThreshold = 1 / (framesPerSecond * 1.5); // Minimum time diff needed
    let rafError: Error | null = null; // To capture errors from async rAF

    console.log(`[MainThread] Attempting to extract ${TARGET_FRAMES} frames via rAF...`); 

    // Wait for initial seek to complete before starting capture
    console.log("[MainThread] rAF: Seeking to start before capture...");
    video.pause(); // Ensure paused before seeking
    video.currentTime = 0;
    await new Promise<void>((resolve, reject) => {
        let seekTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
        const seekedListener = () => {
            if(seekTimeoutTimer) clearTimeout(seekTimeoutTimer);
            console.log("[MainThread] rAF: Initial seek completed.");
            video.onseeked = null; // Cleanup listener
            resolve();
        };
        const errorListener = () => {
             if(seekTimeoutTimer) clearTimeout(seekTimeoutTimer);
             video.onerror = null;
             video.onseeked = null;
             reject(new Error("Error during initial seek to 0"));
        }
        seekTimeoutTimer = setTimeout(() => {
            console.warn("[MainThread] rAF: Initial seek timed out (1s). Proceeding anyway...");
            video.onerror = null;
            video.onseeked = null;
            resolve(); // Resolve even on timeout
        }, 1000);
        video.onseeked = seekedListener;
        video.onerror = errorListener;
    });
    
    // Now start the capture process after initial seek
    const capturePromise = new Promise<void>((resolve, reject) => {

      const captureFrame = async () => {
        // Stop conditions
        if (frames.length >= TARGET_FRAMES) {
          console.log(`[MainThread] rAF: Target ${TARGET_FRAMES} frames captured.`);
          resolve();
          return;
        }
        if (video.ended) {
           console.log("[MainThread] rAF: Video ended before capturing target frames.");
           resolve();
           return;
        }
        if (rafError) { // Check if an error occurred in a previous async step
            reject(rafError);
            return;
        }

        // Throttle capture based on time elapsed
        if (video.currentTime > lastCapturedTime + timeThreshold) {
            try {
                const captureTime = video.currentTime;
                console.log(`[MainThread] rAF: Capturing frame at time ${captureTime.toFixed(3)}s (${frames.length + 1}/${TARGET_FRAMES})`); 
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageBitmap = await createImageBitmap(canvas);
                frames.push({ timestamp: captureTime, bitmap: imageBitmap }); 
                lastCapturedTime = captureTime; 
            } catch (drawError: any) {
                console.error('[MainThread] rAF: Error drawing or creating bitmap:', drawError);
                rafError = drawError instanceof Error ? drawError : new Error(String(drawError));
                resolve(); // Resolve to stop loop, error handled outside
                return;
            }
        }

        // Request next frame if still running
        if (frames.length < TARGET_FRAMES && !video.ended && !rafError) { 
            frameRequestCallbackId = requestAnimationFrame(captureFrame);
        } else {
            resolve(); // Ensure promise resolves if loop condition ends
        }
      };

      // Start playback and capture loop
      console.log('[MainThread] rAF: Starting video playback for frame capture...');
      video.currentTime = 0; // Ensure starting from beginning
      video.play().then(() => {
          console.log('[MainThread] rAF: Playback started, beginning rAF loop.');
          frameRequestCallbackId = requestAnimationFrame(captureFrame);
      }).catch(playError => {
          console.error('[MainThread] rAF: Error starting playback for capture:', playError);
          reject(playError);
      });
    });

    // Wait for capture to finish or the overall timeout
    await Promise.race([capturePromise, operationTimeoutPromise]);
    
    // If rAF loop finished due to an error captured inside it
    if (rafError) {
        throw rafError;
    }

    console.log(`[MainThread] rAF: Finished extraction (target reached, video ended or timeout). Total frames captured: ${frames.length}`); 
    if (frames.length === 0 && video.duration > 0.1) { 
        throw new Error('Failed to extract any frames using rAF method, although video seemed valid.');
    } else if (frames.length < TARGET_FRAMES && !video.ended) {
        console.warn(`[MainThread] rAF: Extracted only ${frames.length}/${TARGET_FRAMES} frames before timeout.`);
    }
    // --- Frame Extraction using requestAnimationFrame --- END ---

  } catch (error) {
      console.error('[MainThread] Error in extractFramesFromFile:', error);
      throw error; // Re-throw error to be caught by handleVideoSelected
  } finally {
      // Ensure cleanup happens
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null; 
      // Cancel animation frame if running
      if (frameRequestCallbackId) cancelAnimationFrame(frameRequestCallbackId);
      frameRequestCallbackId = null;
      console.log('[MainThread] Cleaning up video element and object URL...');
      video.pause();
      video.removeAttribute('src'); // Remove source
      video.onloadedmetadata = null;
      video.onerror = null;
      video.onseeked = null;
      video.load(); // Request browser to release resources associated with the src
      URL.revokeObjectURL(objectUrl);
      console.log('[MainThread] Cleanup complete.');
  }

  return frames;
}
// --- End restored function ---

export default function BackgroundEffects() {
  const setEffect = useVideoEffect();
  const videoRef = useVideo();
  const activeEffect = useAtomValue(activeBackgroundEffectAtom);

  // Restore correct handleVideoSelected
  const handleVideoSelected = useCallback(
    async (file: File) => { 
      console.log(`[MainThread] Background video file selected: ${file.name}`);
      const worker = videoRef?.getWorker_ONLY_USE_WITH_CAUTION();
      if (!worker) {
        console.error('[MainThread] Could not get worker instance.');
        return;
      }
      
      try {
        console.log('[MainThread] Starting background video processing using <video> element rAF...');
        const frames: TimestampedFrame[] = await extractFramesFromFile(file); 

        if (frames && frames.length > 0) {
          // Separate data and transferable objects
          const frameData = frames.map(f => ({ timestamp: f.timestamp }));
          const frameBitmaps = frames.map(f => f.bitmap);
          
          const message: SetBackgroundVideoFramesRequest = { 
              action: 'setBackgroundVideoFrames',
              frameTimestamps: frameData.map(f => f.timestamp), 
              frames: frameBitmaps, 
          };

          // Post message with bitmaps as transferable objects
          worker.postMessage(message, frameBitmaps); 
          console.log(`[MainThread] Sent ${frames.length} frames (with timestamps) to worker.`);
          
        } else {
            console.warn('[MainThread] No frames were extracted from the background video.');
        }
        
      } catch (error) {
          console.error('[MainThread] Failed to process background video:', error);
      }
    },
    [activeEffect, videoRef], 
  );

  // Restore original return structure
  return (
    <ToolbarSection title="Background" borderBottom={false}>
      {backgroundEffects.map(backgroundEffect => {
        return (
          <ToolbarActionIcon
            variant="toggle"
            key={backgroundEffect.title}
            icon={backgroundEffect.Icon}
            title={backgroundEffect.title}
            isActive={activeEffect.name === backgroundEffect.effectName}
            badge={
              activeEffect.name === backgroundEffect.effectName && (
                <EffectVariantBadge
                  label={`${activeEffect.variant + 1}/${activeEffect.numVariants}`}
                />
              )
            }
            onClick={() => {
              if (activeEffect.name === backgroundEffect.effectName) {
                setEffect(backgroundEffect.effectName, EffectIndex.BACKGROUND, {
                  variant:
                    (activeEffect.variant + 1) % activeEffect.numVariants,
                });
              } else {
                setEffect(backgroundEffect.effectName, EffectIndex.BACKGROUND);
              }
            }}
          />
        );
      })}

      {/* Show background video control when background video effect is active */}
      {activeEffect.name === 'BackgroundVideo' && (
        <div className="mt-4 px-2">
          <BackgroundVideoControl onVideoSelected={handleVideoSelected} />
        </div>
      )}
    </ToolbarSection>
  );
}
