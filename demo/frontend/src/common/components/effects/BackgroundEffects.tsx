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
  console.log('[MainThread] Starting extractFramesFromFile (Manual Seek method)...');
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const frames: TimestampedFrame[] = [];
  const objectUrl = URL.createObjectURL(file);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const TARGET_FRAMES = 200; // Target number of frames to extract
  let cancelExtraction = false; // Flag to signal cancellation

  if (!ctx) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Failed to get 2D context from canvas');
  }

  // Overall timeout for the extraction process
  const operationTimeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.error('[MainThread] Frame extraction operation timed out (120s)');
      cancelExtraction = true; // Signal extraction loop to stop
      reject(new Error('Frame extraction operation timed out (120s)'));
    }, 120000); // 120 second overall timeout
  });

  try {
    // --- Load Video Metadata ---
    const loadPromise = new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        console.log('[MainThread] video.onloadedmetadata fired.');
        if (video.duration === Infinity || isNaN(video.duration) || video.duration <= 0) {
            reject(new Error(`Video has invalid duration: ${video.duration}`));
        } else {
            resolve();
        }
      };
      video.onerror = (e) => reject(new Error(`Video loading error: ${video.error?.message || 'Unknown error'}`));

      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata'; // Only need metadata initially
      video.src = objectUrl;
      video.load();
      console.log('[MainThread] video.load() called for metadata.');
    });

    await Promise.race([loadPromise, operationTimeoutPromise]);

    console.log(`[MainThread] Video metadata loaded. Duration: ${video.duration.toFixed(2)}s, ReadyState: ${video.readyState}`);

    if (!video.videoWidth || !video.videoHeight) {
      console.error('[MainThread] Invalid video dimensions:', {
        width: video.videoWidth,
        height: video.videoHeight,
      });
      throw new Error('Failed to get valid video dimensions.');
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    video.pause(); // Ensure video is paused

    // --- Frame Extraction using Manual Seeking --- START ---
    console.log(`[MainThread] Attempting to extract ~${TARGET_FRAMES} frames via manual seeking...`);
    const duration = video.duration;
    const step = duration / TARGET_FRAMES; // Time step between frames
    let framesExtracted = 0;

    // Wrap the seek/capture loop in a promise
    const captureLoopPromise = new Promise<void>(async (resolve, reject) => {
        for (let i = 0; i < TARGET_FRAMES; i++) {
            if (cancelExtraction) { // Check if timeout occurred
                 console.log('[MainThread] Seek loop cancelled due to timeout.');
                 resolve(); // Resolve normally, timeout error handled by Promise.race
                 return;
            }

            const targetTime = i * step;
            // Clamp targetTime to prevent seeking beyond duration
            const currentTime = Math.min(targetTime, duration); 

            console.log(`[MainThread] Seek: Requesting frame ${i + 1}/${TARGET_FRAMES} at time ${currentTime.toFixed(3)}s`);

            try {
                await new Promise<void>((resolveSeek, rejectSeek) => {
                    let seekTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

                    const onSeeked = () => {
                        if (seekTimeoutTimer) clearTimeout(seekTimeoutTimer);
                        video.onseeked = null; // Clean up listener
                        video.onerror = null;
                        
                        // Use rAF to ensure drawing happens after seek completes paint cycle
                        requestAnimationFrame(async () => {
                             if (cancelExtraction) { // Check again before drawing
                                 resolveSeek();
                                 return;
                             }
                             try {
                                 console.log(`[MainThread] Seek: Drawing frame ${i + 1} at ${video.currentTime.toFixed(3)}s`);
                                 ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                 const imageBitmap = await createImageBitmap(canvas);
                                 frames.push({ timestamp: video.currentTime, bitmap: imageBitmap });
                                 framesExtracted++;
                                 resolveSeek();
                             } catch (drawError) {
                                 console.error(`[MainThread] Seek: Error drawing or creating bitmap for frame ${i + 1}`, drawError);
                                 rejectSeek(drawError instanceof Error ? drawError : new Error(String(drawError)));
                             }
                        });
                    };

                    const onError = () => {
                        if (seekTimeoutTimer) clearTimeout(seekTimeoutTimer);
                        video.onseeked = null;
                        video.onerror = null;
                        console.error(`[MainThread] Seek: Error seeking to time ${currentTime.toFixed(3)}s`);
                        // Don't reject the whole loop, just skip this frame
                        // rejectSeek(new Error(`Video seeking error at time ${currentTime.toFixed(3)}s`)); 
                        resolveSeek(); // Resolve to continue with the next frame
                    };

                     // Timeout for a single seek operation (e.g., 5 seconds)
                     seekTimeoutTimer = setTimeout(() => {
                         console.warn(`[MainThread] Seek: Timeout waiting for seek to ${currentTime.toFixed(3)}s`);
                         video.onseeked = null;
                         video.onerror = null;
                         // Don't reject, just skip this frame attempt.
                         resolveSeek(); // Resolve to continue
                     }, 5000); // 5 second timeout per seek

                    video.onseeked = onSeeked;
                    video.onerror = onError;
                    video.currentTime = currentTime;
                });

            } catch (seekError) {
                console.error(`[MainThread] Seek: Unhandled error during seek/capture for frame ${i + 1}:`, seekError);
                // Optionally decide whether to continue or reject the whole process
                // For now, we log and continue
            }
        }
        resolve(); // Resolve capture loop promise when done
    });


    // Wait for the capture loop OR the overall timeout
    await Promise.race([captureLoopPromise, operationTimeoutPromise]);

    console.log(`[MainThread] Seek: Finished extraction process. Total frames captured: ${framesExtracted}`);

    if (framesExtracted === 0 && duration > 0.1) {
      throw new Error('Failed to extract any frames using manual seek method, although video seemed valid.');
    }
    // --- Frame Extraction using Manual Seeking --- END ---

  } catch (error) {
    console.error('[MainThread] Error in extractFramesFromFile:', error);
    // Ensure timeout is cleared if error happens before race completes
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    cancelExtraction = true; // Signal potential ongoing loops to stop
    throw error; // Re-throw error
  } finally {
    // Ensure cleanup happens regardless of success or failure
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    cancelExtraction = true; // Ensure any lingering callbacks know to stop

    console.log('[MainThread] Cleaning up video element and object URL...');
    video.pause();
    video.onloadedmetadata = null; // Remove listeners
    video.onerror = null;
    video.onseeked = null;
    video.removeAttribute('src'); // Break association
    video.load(); // Helps release resources
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
