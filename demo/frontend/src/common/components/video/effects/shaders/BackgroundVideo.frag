#version 300 es
// Copyright (c) Meta Platforms, Inc. and affiliates.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

precision lowp float;

in vec2 vTexCoord;
uniform vec2 uSize;
uniform int uNumMasks;
uniform sampler2D uSampler; // Main video texture
uniform sampler2D uBackgroundVideo; // Background video texture
uniform float uMixValue; // Controls the strength of the effect (0-1)
uniform sampler2D uMaskTexture0;
uniform sampler2D uMaskTexture1;
uniform sampler2D uMaskTexture2;

uniform vec4 bbox0;
uniform vec4 bbox1;
uniform vec4 bbox2;

out vec4 fragColor;

void main() {
  // Sample the main video
  vec4 mainVideoColor = texture(uSampler, vTexCoord);
  
  // Sample the background video - we'll scale/position it to fit the frame
  vec4 bgVideoColor = texture(uBackgroundVideo, vTexCoord);
  
  // Calculate cumulative mask value to determine foreground/background
  float totalMaskValue = 0.0;
  
  if(uNumMasks > 0) {
    // Use vec2(vTexCoord.y, vTexCoord.x) for the mask texture to swap X and Y
    float maskValue0 = texture(uMaskTexture0, vec2(vTexCoord.y, vTexCoord.x)).r;
    totalMaskValue += maskValue0;
  }
  if(uNumMasks > 1) {
    float maskValue1 = texture(uMaskTexture1, vec2(vTexCoord.y, vTexCoord.x)).r;
    totalMaskValue += maskValue1;
  }
  if(uNumMasks > 2) {
    float maskValue2 = texture(uMaskTexture2, vec2(vTexCoord.y, vTexCoord.x)).r;
    totalMaskValue += maskValue2;
  }
  
  // Create a sandwich effect:
  // Layer 1 (bottom): Original video background
  // Layer 2 (middle): Background video, only visible where there are no objects 
  //                   and respect transparency (alpha) to blend with original background
  // Layer 3 (top): Segmented objects from original video
  vec4 finalColor;
  
  if (totalMaskValue > 0.0) {
    // Foreground - use original video (top layer)
    finalColor = mainVideoColor;
  } else {
    // Background area - blend the middle layer with the bottom layer based on alpha
    // This allows transparent parts of the uploaded video to show the original video behind it
    
    // First, blend the background video with the original video based on alpha
    // Calculate blend factor - use bgVideoColor.a for actual transparency
    float alpha = bgVideoColor.a;
    
    // Blend background video with original video based on alpha
    // When alpha is 1.0 (fully opaque), use only uploaded video
    // When alpha is 0.0 (fully transparent), use only original video
    // For values in between, blend proportionally
    finalColor = mix(mainVideoColor, bgVideoColor, alpha);
  }
  
  fragColor = finalColor;
}