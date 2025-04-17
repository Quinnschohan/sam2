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
import {Tracklet} from '@/common/tracker/Tracker';
import {DEMO_SHORT_NAME} from '@/demo/DemoConfig';
import {CanvasForm} from 'pts';
import {AbstractEffect, EffectFrameContext} from './Effect';

// Create our own versions of the Pts utilities needed
class Pt {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  toBound() {
    return new Bound(this.x, this.y);
  }

  scale(scale: number, anchor: [number, number]) {
    return this;
  }
}

class Bound {
  x: number;
  y: number;
  width: number;
  height: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.width = 0;
    this.height = 0;
  }

  static fromArray(corners: number[][]) {
    const bound = new Bound(corners[0][0], corners[0][1]);
    bound.width = corners[1][0] - corners[0][0];
    bound.height = corners[1][1] - corners[0][1];
    return bound;
  }
}

class Num {
  static cycle(t: number) {
    return t - Math.floor(t);
  }
}

class Shaping {
  static quadraticInOut(t: number) {
    if (t < 0.5) return 2 * t * t;
    return -1 + (4 - 2 * t) * t;
  }

  static sineInOut(t: number, size: number = 1) {
    return size * (Math.sin(t * Math.PI - Math.PI/2) + 1) / 2;
  }
}

export default class BackgroundTextEffect extends AbstractEffect {
  constructor() {
    super(2);
  }

  apply(
    form: CanvasForm,
    context: EffectFrameContext,
    _tracklets: Tracklet[],
  ): void {
    // Draw the video frame as background
    const ctx = form.ctx;
    ctx.drawImage(context.frame, 0, 0);

    const words = ['SEGMENT', 'ANYTHING', 'WOW'];
    const paragraph = `${DEMO_SHORT_NAME} is designed for efficient video processing with streaming inference to enable real-time, interactive applications.`;
    const progress = context.frameIndex / context.totalFrames;

    // Zooming heading
    if (this.variant % 2 === 0) {
      const step = context.totalFrames / words.length;
      const wordIndex = Math.floor(progress * words.length);
      const fontSize = context.width / Math.max(4, words[wordIndex].length - 1);
      const sizeMax = fontSize * 1.2;

      const t = Shaping.quadraticInOut(
        Num.cycle((context.frameIndex - wordIndex * step) / step),
      );
      const currentSize = fontSize + Shaping.sineInOut(t, sizeMax - fontSize);
      
      // Handle text display with direct Canvas API
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${currentSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Calculate position for centered text
      const x = context.width / 2;
      const y = context.height / 2 - (context.height / 8) * (1 - t);
      
      ctx.fillText(words[wordIndex], x, y);

    // Scrolling paragraph
    } else {
      const t = Shaping.quadraticInOut(Num.cycle(progress));
      const offset = t * context.height;
      
      // Create semi-transparent background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, -context.height + offset, context.width, context.height * 2);
      
      // Draw text
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${context.width / 16}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      // Simple text wrapping
      const lineHeight = context.width / 12;
      const maxWidth = context.width - 40;
      const words = paragraph.split(' ');
      let line = '';
      let y = -context.height + offset + 20;
      
      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
          ctx.fillText(line, 20, y);
          line = words[i] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 20, y);
    }
  }
}
