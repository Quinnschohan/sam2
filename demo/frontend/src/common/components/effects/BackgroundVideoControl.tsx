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

import React, {useCallback, useEffect, useRef, useState} from 'react';
// No longer using quick test mode here

type BackgroundVideoControlProps = {
  onVideoSelected: (file: File) => void;
};

export default function BackgroundVideoControl({
  onVideoSelected,
}: BackgroundVideoControlProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        setSelectedFile(file);
        setIsLoading(true);
        setError(null);

        try {
          // Use a temporary video element for validation
          const videoElement = document.createElement('video');
          videoElement.muted = true;
          const tempUrl = URL.createObjectURL(file); // Create URL just for validation
          
          // Create a promise to wait for either metadata or error
          const validationPromise = new Promise<void>((resolve, reject) => {
            videoElement.onloadedmetadata = () => resolve();
            videoElement.onerror = () => reject(new Error("Video format not supported"));
            
            // Also set a reasonable timeout
            setTimeout(() => {
              if (videoElement.readyState === 0) {
                reject(new Error("Video loading timed out"));
              } else {
                resolve();
              }
            }, 5000);
          });
          
          // Start loading for validation
          videoElement.src = tempUrl; 
          
          // Wait for validation
          await validationPromise;

          // Revoke the temporary validation URL
          URL.revokeObjectURL(tempUrl);
          
          // Pass the File object directly
          onVideoSelected(file);
          setIsLoading(false);
        } catch (err) {
          console.error("Error pre-validating video:", err);
          setError(err instanceof Error ? err.message : "Unknown error loading video");
          setIsLoading(false);
          
          // Clean up validation URL if it exists and failed
          if (videoElement.src && videoElement.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoElement.src);
          }
        }
      }
    },
    [onVideoSelected],
  );

  const handleClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // No longer handling quick test mode here

  return (
    <div className="background-video-control">
      <div className="flex flex-col items-center">
        <button
          onClick={handleClick}
          disabled={isLoading}
          className={`px-4 py-2 text-white rounded-md transition-colors mb-2 
            ${isLoading 
              ? 'bg-blue-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700'}`}>
          {isLoading 
            ? 'Loading video...' 
            : (selectedFile ? 'Change background video' : 'Select background video')}
        </button>
        
        {error && (
          <div className="text-sm text-red-600 mt-1 mb-2">
            Error: {error}
          </div>
        )}
        
        {selectedFile && !isLoading && !error && (
          <div className="text-sm text-gray-600">
            Selected: {selectedFile.name}
          </div>
        )}
        
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}