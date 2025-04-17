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
import {quickTestModeAtom} from '@/demo/atoms';
import {setupQuickTestMode} from '@/demo/DemoConfig';
import {useAtom} from 'jotai';
import React from 'react';

export default function QuickSegmentationToggle() {
  const [quickTestMode, setQuickTestMode] = useAtom(quickTestModeAtom);

  const toggleQuickTestMode = () => {
    const newValue = !quickTestMode;
    setQuickTestMode(newValue);
    setupQuickTestMode(newValue);
  };

  return (
    <div className="flex flex-col items-center mt-2">
      <div className="flex items-center mb-1">
        <label className="flex items-center cursor-pointer">
          <div className="relative">
            <input 
              type="checkbox" 
              className="sr-only"
              checked={quickTestMode}
              onChange={toggleQuickTestMode}
            />
            <div className={`block w-10 h-5 rounded-full ${quickTestMode ? 'bg-blue-600' : 'bg-gray-400'}`}></div>
            <div className={`absolute left-1 top-0.5 bg-white w-4 h-4 rounded-full transition ${quickTestMode ? 'transform translate-x-5' : ''}`}></div>
          </div>
          <div className="ml-2 text-sm font-medium">
            Quick Segmentation
          </div>
        </label>
      </div>
      
      <div className="text-xs text-center max-w-xs">
        {quickTestMode ? (
          <span className="text-amber-600">
            <span role="img" aria-label="lightning">⚡</span> Only tracking first ~2 seconds to save time
          </span>
        ) : (
          <span className="text-gray-500">
            <span role="img" aria-label="clock">⏱️</span> Tracking entire video (may take a while)
          </span>
        )}
      </div>
    </div>
  );
}