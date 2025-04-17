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
import BaseGLEffect from '@/common/components/video/effects/BaseGLEffect';
import {
  EffectFrameContext,
  EffectInit,
  EffectOptions,
} from '@/common/components/video/effects/Effect';
import vertexShaderSource from '@/common/components/video/effects/shaders/DefaultVert.vert?raw';
import fragmentShaderSource from '@/common/components/video/effects/shaders/BackgroundVideo.frag?raw';
import {Tracklet} from '@/common/tracker/Tracker';
import {normalizeBounds, preAllocateTextures} from '@/common/utils/ShaderUtils';
import {RLEObject, decode} from '@/jscocotools/mask';
import invariant from 'invariant';
import {CanvasForm} from 'pts';

export default class BackgroundVideoEffect extends BaseGLEffect {
  private _numMasks: number = 0;
  private _numMasksUniformLocation: WebGLUniformLocation | null = null;
  private _mixValueLocation: WebGLUniformLocation | null = null;
  private _masksTextureUnitStart: number = 2;
  private _maskTextures: WebGLTexture[] = [];
  
  // Background video properties
  private _backgroundVideoTextureUnit: number = 1;
  private _backgroundVideoTexture: WebGLTexture | null = null;
  private _backgroundVideo: ImageBitmap | null = null;
  private _backgroundVideoFrames: ImageBitmap[] = [];
  private _backgroundVideoSrc: string | null = null;

  constructor() {
    super(4); // Number of variants (e.g., different mixing values or visual styles)
    this.vertexShaderSource = vertexShaderSource;
    this.fragmentShaderSource = fragmentShaderSource;
  }

  async update(options: EffectOptions): Promise<void> {
    await super.update(options);
    
    // If this update includes a new background video URL, load it
    if (options.backgroundVideoSrc && this._backgroundVideoSrc !== options.backgroundVideoSrc) {
      console.log("Loading new background video:", options.backgroundVideoSrc);
      
      // Clear any previously loaded background video frames
      this._backgroundVideoFrames = [];
      this._backgroundVideo = null;
      
      this._backgroundVideoSrc = options.backgroundVideoSrc;
      await this.loadBackgroundVideo(options.backgroundVideoSrc);
    }
  }

  private async loadBackgroundVideo(src: string): Promise<void> {
    try {
      console.log(`[BackgroundVideoEffect] loadBackgroundVideo called with src: ${src}`);
      console.log(`[BackgroundVideoEffect] Starting to load background video from: ${src}`);
      // Clear existing frames
      this._backgroundVideoFrames = [];
      
      // Create a static placeholder frame first to avoid blank display
      const placeholderCanvas = new OffscreenCanvas(640, 480);
      const placeholderCtx = placeholderCanvas.getContext('2d');
      if (placeholderCtx) {
        // Create a gradient placeholder
        const gradient = placeholderCtx.createLinearGradient(0, 0, 640, 480);
        gradient.addColorStop(0, '#333333');
        gradient.addColorStop(1, '#999999');
        placeholderCtx.fillStyle = gradient;
        placeholderCtx.fillRect(0, 0, 640, 480);
        placeholderCtx.fillStyle = 'rgba(255,255,255,0.5)';
        placeholderCtx.font = '24px sans-serif';
        placeholderCtx.textAlign = 'center';
        placeholderCtx.fillText('Loading background video...', 320, 240);
        
        try {
          const placeholderBitmap = await createImageBitmap(placeholderCanvas);
          this._backgroundVideoFrames.push(placeholderBitmap);
          this._backgroundVideo = placeholderBitmap;
        } catch (e) {
          console.warn('Could not create placeholder bitmap');
        }
      }
      
      // Create and set up a video element to handle any video format including WebM
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.autoplay = false;
      video.muted = true;
      video.playsInline = true;
      console.log('[BackgroundVideoEffect] Created video element');
      
      // Wait for video to have loadeddata event or error
      const videoLoadPromise = new Promise<HTMLVideoElement>((resolve, reject) => {
        console.log('[BackgroundVideoEffect] Setting up video event listeners');
        // Success handlers
        video.onloadeddata = () => { console.log('[BackgroundVideoEffect] video.onloadeddata triggered'); resolve(video); };
        video.oncanplay = () => { console.log('[BackgroundVideoEffect] video.oncanplay triggered'); resolve(video); };
        
        // Error handlers
        video.onerror = (e) => {
          console.error('[BackgroundVideoEffect] video.onerror triggered:', video.error);
          reject(new Error(`Failed to load video: ${video.error?.message || 'Unknown error'}`));
        };
        
        // Add a timeout in case events aren't triggered
        setTimeout(() => {
          if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
            resolve(video);
          } else {
            console.warn('Video loading timed out after 8 seconds');
            // Try to resolve anyway to avoid complete failure
            if (video.readyState >= 1) { // At least HAVE_METADATA
              resolve(video);
            } else {
              reject(new Error('Video load timeout - insufficient data available'));
            }
          }
        }, 8000);
      });
      
      // Set the source and start loading
      console.log(`[BackgroundVideoEffect] Setting video.src = ${src}`);
      video.src = src;
      video.load();
      console.log('[BackgroundVideoEffect] video.load() called');
      
      // Wait for video to load
      try {
        await videoLoadPromise;
        console.log('[BackgroundVideoEffect] videoLoadPromise resolved successfully:', {
          duration: video.duration,
          width: video.videoWidth, 
          height: video.videoHeight,
          readyState: video.readyState
        });
      } catch (error) {
        console.error('[BackgroundVideoEffect] videoLoadPromise rejected:', error);
        
        // Don't exit immediately - try to continue with a fallback approach
        console.warn('Attempting fallback video loading method...');
        
        // Give the video a bit more time to load metadata at minimum
        try {
          if (!video.duration && !video.videoWidth) {
            // Force a wait for at least some metadata
            await new Promise<void>((resolve) => {
              const metadataTimeout = setTimeout(() => {
                resolve(); // Resolve anyway after extended timeout
              }, 3000);
              
              video.onloadedmetadata = () => {
                clearTimeout(metadataTimeout);
                resolve();
              };
            });
          }
          
          // If we have at least basic dimensions, try to continue
          if (video.videoWidth && video.videoHeight) {
            console.log('Fallback loading succeeded with basic metadata:', {
              width: video.videoWidth,
              height: video.videoHeight
            });
          } else {
            console.error('Fallback loading failed - no usable video data');
            return; // Now exit - we'll use the placeholder
          }
        } catch (fallbackError) {
          console.error('Fallback video loading also failed:', fallbackError);
          return; // Exit early but don't throw - we'll use the placeholder
        }
      }
      
      // Extract enough frames to cover the video
      const maxDuration = video.duration;
      
      // For longer videos, extract fewer frames per second to avoid memory issues
      const framesPerSecond = (maxDuration > 10) ? 2 : 3; // Lower frame rate for longer videos
      const totalFrames = Math.min(30, Math.floor(maxDuration * framesPerSecond) || 5);
      
      console.log("Note: Video transparency will be preserved if your uploaded video has alpha channel");
      
      // Create a temporary canvas to capture frames
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;  // Fallback width if video dimensions are not available
      canvas.height = video.videoHeight || 480;  // Fallback height
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }
      
      // Clear any placeholder frames before extracting actual frames
      this._backgroundVideoFrames = [];
      
      // Extract frames by seeking to different positions
      for (let i = 0; i < totalFrames; i++) {
        // Calculate time position within the first 2 seconds (or less)
        const timePosition = (i / totalFrames) * maxDuration;
        
        try {
          // Set the current time and wait for the seeking to complete
          video.currentTime = timePosition;
          await new Promise<void>((resolve) => {
            const seekTimeout = setTimeout(() => {
              resolve(); // Resolve anyway after timeout
            }, 300);
            
            video.onseeked = () => {
              clearTimeout(seekTimeout);
              resolve();
            };
          });
          
          // Draw the frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Convert to ImageBitmap and add to frames
          const imageBitmap = await createImageBitmap(canvas);
          this._backgroundVideoFrames.push(imageBitmap);
          
        } catch (error) {
          console.warn(`Error extracting frame ${i}:`, error);
          // Continue with other frames
        }
      }
      
      // If we couldn't extract any frames, create a dummy one
      if (this._backgroundVideoFrames.length === 0) {
        console.warn('No frames extracted, creating fallback frame');
        ctx.fillStyle = 'purple'; // Fallback color to make it obvious something loaded
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        try {
          const imageBitmap = await createImageBitmap(canvas);
          this._backgroundVideoFrames.push(imageBitmap);
        } catch (error) {
          console.error('Failed to create fallback ImageBitmap:', error);
        }
      }
      
      // Clean up
      video.pause();
      video.removeAttribute('src');
      video.load(); // Properly unload the video resource
      
      // Set the initial frame
      if (this._backgroundVideoFrames.length > 0) {
        this._backgroundVideo = this._backgroundVideoFrames[0];
        console.log(`[BackgroundVideoEffect] Successfully loaded ${this._backgroundVideoFrames.length} frames from background video`);
      } else {
        console.warn('[BackgroundVideoEffect] No frames were extracted from the background video');
      }
    } catch (error) {
      console.error('[BackgroundVideoEffect] Outer catch block triggered:', error);
      
      // Create a simple error indicator frame if all else fails
      try {
        const errorCanvas = new OffscreenCanvas(320, 240);
        const errorCtx = errorCanvas.getContext('2d');
        if (errorCtx) {
          errorCtx.fillStyle = 'rgba(255,0,0,0.3)';
          errorCtx.fillRect(0, 0, 320, 240);
          errorCtx.fillStyle = 'white';
          errorCtx.font = '16px sans-serif';
          errorCtx.textAlign = 'center';
          errorCtx.fillText('Error loading video', 160, 120);
          
          const errorBitmap = await createImageBitmap(errorCanvas);
          this._backgroundVideoFrames = [errorBitmap];
          this._backgroundVideo = errorBitmap;
        }
      } catch (e) {
        // Last resort - we tried everything
        console.error('Could not create error message bitmap');
      }
    }
  }

  protected async setupUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    init: EffectInit,
  ) {
    super.setupUniforms(gl, program, init);
    
    // Create and set up background video texture
    if (this._backgroundVideoTexture) {
      gl.deleteTexture(this._backgroundVideoTexture);
    }
    this._backgroundVideoTexture = gl.createTexture();
    
    // Initialize mask count uniform
    this._numMasksUniformLocation = gl.getUniformLocation(program, 'uNumMasks');
    gl.uniform1i(this._numMasksUniformLocation, this._numMasks);
    
    // Set mix value uniform based on variant - now 1.0 means show 100% background video
    this._mixValueLocation = gl.getUniformLocation(program, 'uMixValue');
    gl.uniform1f(this._mixValueLocation, 1.0); // Default to full replacement
    
    // Set background video texture sampler
    gl.uniform1i(
      gl.getUniformLocation(program, 'uBackgroundVideo'),
      this._backgroundVideoTextureUnit,
    );
    
    // Pre-allocate mask textures (supporting up to 3 masks)
    this._maskTextures = preAllocateTextures(gl, 3);
    
    // Initialize the background video texture with a placeholder
    gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
    gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture);
    
    // Create a 1x1 transparent pixel
    const tempData = new Uint8Array([0, 0, 0, 0]);  
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1, 1, 0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      tempData
    );
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Enable alpha blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  apply(form: CanvasForm, context: EffectFrameContext, _tracklets: Tracklet[]) {
    const gl = this._gl;
    const program = this._program;

    invariant(gl !== null, 'WebGL2 context is required');
    invariant(program !== null, 'No WebGL program found');

    gl.clearColor(0.0, 0.0, 0.0, 0.0); // Clear with transparent black
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Make sure blending is still enabled
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set up the main video texture first
    gl.activeTexture(gl.TEXTURE0 + this._frameTextureUnit);
    gl.bindTexture(gl.TEXTURE_2D, this._frameTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      context.frame.width,
      context.frame.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      context.frame,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Update mix value based on variant (0.0 to 1.0 range)
    const mixValues = [1.0, 0.9, 0.8, 0.7]; // Reversed to make stronger effect first
    gl.uniform1f(this._mixValueLocation, mixValues[this.variant % mixValues.length]);

    // Update mask count
    gl.uniform1i(this._numMasksUniformLocation, context.masks.length);

    // Update and bind background video frame
    if (this._backgroundVideoFrames.length > 0) {
      // Determine which background frame to show based on the current video frame
      const bgFrameCount = this._backgroundVideoFrames.length;
      
      // Use time parameter if available, otherwise use frame index
      let mainProgress;
      if (context.timeParameter !== undefined) {
        // timeParameter is normalized between 0-1
        mainProgress = context.timeParameter;
      } else {
        mainProgress = context.frameIndex / Math.max(1, context.totalFrames);
      }
      
      const bgFrameIndex = Math.floor(mainProgress * bgFrameCount) % bgFrameCount;
      this._backgroundVideo = this._backgroundVideoFrames[bgFrameIndex];
      
      // Bind the background video texture
      gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture);
      
      if (this._backgroundVideo) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          this._backgroundVideo.width,
          this._backgroundVideo.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this._backgroundVideo,
        );
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        console.log('Background video frame bound successfully', bgFrameIndex);
      } else {
        console.warn('No background video frame available');
      }
    } else {
      console.warn('No background video frames loaded');
    }

    // Process and bind all mask textures
    context.masks.forEach((mask, index) => {
      try {
        const decodedMask = decode([mask.bitmap as RLEObject]);
        const maskData = decodedMask.data as Uint8Array;
        
        gl.activeTexture(gl.TEXTURE0 + index + this._masksTextureUnitStart);
        gl.bindTexture(gl.TEXTURE_2D, this._maskTextures[index]);

        const boundaries = normalizeBounds(
          mask.bounds[0],
          mask.bounds[1],
          context.width,
          context.height,
        );

        gl.uniform1i(
          gl.getUniformLocation(program, `uMaskTexture${index}`),
          index + this._masksTextureUnitStart,
        );
        gl.uniform4fv(gl.getUniformLocation(program, `bbox${index}`), boundaries);

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        
        // Fix mask issues:
        // 1. Use actual mask dimensions
        // 2. Set NEAREST filtering to prevent blurring/trailing
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.LUMINANCE, 
          // @ts-ignore
          decodedMask.size[1],  // Use actual dimensions from the mask
          // @ts-ignore
          decodedMask.size[0],  // Use actual dimensions from the mask
          0,
          gl.LUMINANCE,
          gl.UNSIGNED_BYTE,
          maskData,
        );
        
        // Set texture parameters to avoid trailing effects
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } catch (error) {
        console.error(`Error processing mask ${index}:`, error);
      }
    });

    // Draw the scene
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Unbind textures
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    // Draw the result to the main canvas
    const ctx = form.ctx;
    invariant(this._canvas !== null, 'Canvas is required');
    ctx.drawImage(this._canvas, 0, 0);
  }

  async cleanup(): Promise<void> {
    // Clean up WebGL resources
    await super.cleanup();

    if (this._gl != null) {
      // Delete background video texture
      if (this._backgroundVideoTexture != null) {
        this._gl.deleteTexture(this._backgroundVideoTexture);
        this._backgroundVideoTexture = null;
      }
      
      // Delete mask textures
      this._maskTextures.forEach(texture => {
        if (texture != null && this._gl != null) {
          this._gl.deleteTexture(texture);
        }
      });
      this._maskTextures = [];
      
      // Close background video frames
      this._backgroundVideoFrames = [];
      this._backgroundVideo = null;
    }
  }
}