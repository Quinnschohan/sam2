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

// Define structure for internal storage
type TimestampedBitmapFrame = { timestamp: number; bitmap: ImageBitmap };

export default class BackgroundVideoEffect extends BaseGLEffect {
  private _numMasks: number = 0;
  private _numMasksUniformLocation: WebGLUniformLocation | null = null;
  private _mixValueLocation: WebGLUniformLocation | null = null;
  private _masksTextureUnitStart: number = 2;
  private _maskTextures: WebGLTexture[] = [];
  
  // Background video properties
  private _backgroundVideoTextureUnit: number = 1;
  private _backgroundVideoTexture: WebGLTexture | null = null;
  private _backgroundVideo: TimestampedBitmapFrame | null = null;
  public _backgroundVideoFrames: TimestampedBitmapFrame[] = [];

  constructor() {
    super(4); // Number of variants (e.g., different mixing values or visual styles)
    this.vertexShaderSource = vertexShaderSource;
    this.fragmentShaderSource = fragmentShaderSource;
  }

  async update(options: EffectOptions): Promise<void> {
    await super.update(options);
  }

  public setBackgroundFrames(timestamps: number[], bitmaps: ImageBitmap[]): void {
    // Close existing frames if necessary
    this._backgroundVideoFrames.forEach(frame => {
      try {
        frame.bitmap.close(); // Close bitmap 
      } catch (e) {
        // Ignore potential errors if closing is not supported/needed
      }
    });

    if (timestamps.length !== bitmaps.length) {
        console.error('[BackgroundVideoEffect] Mismatch between timestamps and bitmaps count!');
        this._backgroundVideoFrames = [];
    } else {
        // Combine timestamps and bitmaps
        this._backgroundVideoFrames = timestamps.map((timestamp, index) => ({ 
            timestamp: timestamp,
            bitmap: bitmaps[index]
        }));
        // Sort frames by timestamp
        this._backgroundVideoFrames.sort((a, b) => a.timestamp - b.timestamp);
    }
    
    if (this._backgroundVideoFrames.length > 0) {
      this._backgroundVideo = this._backgroundVideoFrames[0]; // Set initial frame
      console.log(`[BackgroundVideoEffect] Received and processed ${this._backgroundVideoFrames.length} background frames.`);
    } else {
      this._backgroundVideo = null;
      console.warn('[BackgroundVideoEffect] Received empty background frames array.');
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

    // If initial frames are already available (e.g., default), load the first one
    if (this._backgroundVideoFrames.length > 0) {
      this._backgroundVideo = this._backgroundVideoFrames[0];
      if (this._backgroundVideo) {
        gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._backgroundVideo.bitmap);
      }
    }

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
      // Determine which background frame to show based on the current video TIME
      const bgFrameCount = this._backgroundVideoFrames.length;
      
      // Calculate main video current time (in seconds)
      const mainCurrentTime = context.fps > 0 ? context.frameIndex / context.fps : 0;

      // Find the closest background frame by timestamp
      // (Using simple linear search for now, could optimize with binary search if needed)
      let closestFrame = this._backgroundVideoFrames[0] || null;
      let minDiff = Infinity;

      for (const frame of this._backgroundVideoFrames) {
          const diff = Math.abs(frame.timestamp - mainCurrentTime);
          if (diff < minDiff) {
              minDiff = diff;
              closestFrame = frame;
          } else {
              // Since frames are sorted, once the difference increases, we can stop.
              break; 
          }
      }
      
      this._backgroundVideo = closestFrame; 

      // Bind the background video texture
      gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture);
      
      if (this._backgroundVideo) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          this._backgroundVideo.bitmap.width, // Use actual bitmap dimensions
          this._backgroundVideo.bitmap.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          // Use the bitmap property of the selected frame
          this._backgroundVideo.bitmap, 
        );
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
      } else {
        // Bind placeholder texture if no frame found (or cleared due to error)
         gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
         gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture); // Rebind placeholder if needed
         const tempData = new Uint8Array([0, 0, 0, 0]); 
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tempData);
      }
    } else {
       // Bind placeholder texture if no frames are loaded
       gl.activeTexture(gl.TEXTURE0 + this._backgroundVideoTextureUnit);
       gl.bindTexture(gl.TEXTURE_2D, this._backgroundVideoTexture); // Rebind placeholder if needed
       const tempData = new Uint8Array([0, 0, 0, 0]); 
       gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tempData);
    }

    // Process and bind all mask textures (Original Logic)
    context.masks.forEach((mask, index) => {
      let decodedMask, maskData;
      try {
        // Check if mask.bitmap is defined and is an RLEObject
        if (!mask || !mask.bitmap || typeof (mask.bitmap as RLEObject).counts !== 'string') { 
          console.warn(`[Worker] Skipping mask ${index}: mask.bitmap is not a valid RLEObject.`);
          return;
        }
        decodedMask = decode([mask.bitmap as RLEObject]);
        if (!decodedMask || !decodedMask.data) { 
          console.warn(`[Worker] Skipping mask ${index}: decodedMask or decodedMask.data is undefined after decode.`);
          return;
        }
        maskData = decodedMask.data as Uint8Array;
        
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
        
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.LUMINANCE, // Use LUMINANCE for single-channel mask data
          context.width, // Use full context width
          context.height,// Use full context height
          0,
          gl.LUMINANCE,
          gl.UNSIGNED_BYTE,
          maskData, 
        );
        
        // Set texture parameters (NEAREST filtering)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      } catch (error) {
        console.error(`[Worker] Error processing mask ${index}:`, error);
        console.error(`[Worker] Mask object for index ${index}:`, mask);
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

      // Close background video frames and clear array
      this._backgroundVideoFrames.forEach(frame => {
        try {
          frame.bitmap.close(); // Close the bitmap part
        } catch (e) {
          // Ignore potential errors if closing is not supported/needed
        }
      });
      this._backgroundVideoFrames = [];
      this._backgroundVideo = null;
    }
  }
}