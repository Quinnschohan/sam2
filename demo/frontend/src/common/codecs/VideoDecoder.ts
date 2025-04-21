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
import {cloneFrame} from '@/common/codecs/WebCodecUtils';
import {FileStream} from '@/common/utils/FileUtils';
import {
  createFile,
  DataStream,
  MP4ArrayBuffer,
  MP4File,
  MP4Sample,
  MP4VideoTrack,
} from 'mp4box';
import {isAndroid, isChrome, isEdge, isWindows} from 'react-device-detect';

export type ImageFrame = {
  bitmap: VideoFrame;
  timestamp: number;
  duration: number;
  fps: number;
};

export type DecodedVideo = {
  width: number;
  height: number;
  frames: ImageFrame[];
  numFrames: number;
  fps: number;
};

export function decodeInternal(
  identifier: string,
  onReady: (mp4File: MP4File) => Promise<void>,
  onProgress: (decodedVideo: DecodedVideo) => boolean,
): Promise<DecodedVideo> {
  return new Promise((resolve, reject) => {
    const imageFrames: ImageFrame[] = [];
    const globalSamples: MP4Sample[] = [];

    let decoder: VideoDecoder | null = null;
    let track: MP4VideoTrack | null = null;
    const mp4File = createFile();
    let isDecodingStopped = false;

    const cleanupDecoder = () => {
      if (isDecodingStopped) return;
      isDecodingStopped = true;
      console.log(`[VideoDecoder ${identifier}] Cleaning up decoder...`);
      try {
        mp4File?.stop();
        if (decoder && decoder.state !== 'closed') {
          decoder.close();
        }
      } catch (e) {
        console.warn(`[VideoDecoder ${identifier}] Error during cleanup:`, e);
      } finally {
        decoder = null;
      }
    };

    mp4File.onError = (err) => {
      cleanupDecoder();
      reject(err);
    }
    mp4File.onReady = async info => {
      if (info.videoTracks.length > 0) {
        track = info.videoTracks[0];
      } else {
        track = info.otherTracks[0];
      }

      if (track == null) {
        reject(new Error(`${identifier} does not contain a video track`));
        return;
      }

      const timescale = track.timescale;
      const edits = track.edits;

      let frame_n = 0;
      decoder = new VideoDecoder({
        async output(inputFrame) {
          let shouldContinue = true;
          
          if (isDecodingStopped || !decoder || !track) {
            inputFrame.close();
            return;
          }

          const saveTrack = track;

          if (edits != null && edits.length > 0) {
            const cts = Math.round(
              (inputFrame.timestamp * timescale) / 1_000_000,
            );
            if (cts < edits[0].media_time) {
              inputFrame.close();
              return;
            }
          }

          if (
            (isAndroid && isChrome) ||
            (isWindows && isChrome) ||
            (isWindows && isEdge)
          ) {
            const clonedFrame = await cloneFrame(inputFrame);
            inputFrame.close();
            inputFrame = clonedFrame;
          }

          const sample = globalSamples[frame_n];
          if (sample != null) {
            const duration = (sample.duration * 1_000_000) / sample.timescale;
            imageFrames.push({
              bitmap: inputFrame,
              timestamp: inputFrame.timestamp,
              duration,
              fps:
                (saveTrack.nb_samples / saveTrack.duration) *
                saveTrack.timescale,
            });
            imageFrames.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
            if (onProgress != null && (frame_n === 0 || frame_n % 10 === 0)) {
              shouldContinue = onProgress({
                width: saveTrack.track_width,
                height: saveTrack.track_height,
                frames: imageFrames,
                numFrames: saveTrack.nb_samples,
                fps:
                  (saveTrack.nb_samples / saveTrack.duration) *
                  saveTrack.timescale,
              });
            }
          }
          frame_n++;

          if (!shouldContinue || saveTrack.nb_samples === frame_n) {
            cleanupDecoder();
            
            if (saveTrack.nb_samples === frame_n) {
              imageFrames.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
              resolve({
                width: saveTrack.track_width,
                height: saveTrack.track_height,
                frames: imageFrames,
                numFrames: saveTrack.nb_samples,
                fps:
                  (saveTrack.nb_samples / saveTrack.duration) *
                  saveTrack.timescale,
              });
            } else {
              console.log(`[VideoDecoder ${identifier}] Decoding stopped early by callback.`);
            }
          }
        },
        error(error) {
          cleanupDecoder();
          reject(error);
        },
      });

      let description;
      const trak = mp4File.getTrackById(track.id);
      const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
      if (entries == null) {
        return;
      }
      for (const entry of entries) {
        if (entry.avcC || entry.hvcC) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          if (entry.avcC) {
            entry.avcC.write(stream);
          } else if (entry.hvcC) {
            entry.hvcC.write(stream);
          }
          description = new Uint8Array(stream.buffer, 8);
          break;
        }
      }

      const configuration: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: track.track_width,
        codedHeight: track.track_height,
        description,
      };
      // Log configuration
      console.log(`[VideoDecoder ${identifier}] Attempting configuration:`, configuration);
      const supportedConfig =
        await VideoDecoder.isConfigSupported(configuration);
      // Log support result
      console.log(`[VideoDecoder ${identifier}] isConfigSupported result:`, supportedConfig);
      if (supportedConfig.supported == true) {
        // Log before configure
        console.log(`[VideoDecoder ${identifier}] Configuring decoder...`);
        decoder.configure(configuration);
        // Log after configure
        console.log(`[VideoDecoder ${identifier}] Decoder configured. State: ${decoder.state}`);

        mp4File.setExtractionOptions(track.id, null, {
          nbSamples: Infinity,
        });
        mp4File.start();
      } else {
        reject(
          new Error(
            `Decoder config faile: config ${JSON.stringify(
              supportedConfig.config,
            )} is not supported`,
          ),
        );
        cleanupDecoder();
        return;
      }
    };

    mp4File.onSamples = async (
      _id: number,
      _user: unknown,
      samples: MP4Sample[],
    ) => {
      console.log(`[VideoDecoder ${identifier}] mp4box.onSamples called with ${samples.length} samples.`); 
      if (isDecodingStopped || !decoder) {
          console.log(`[VideoDecoder ${identifier}] onSamples: Skipped decoding (stopped or no decoder).`);
          return;
      }

      for (const sample of samples) {
        if (isDecodingStopped || !decoder) break;
        globalSamples.push(sample);
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: (sample.cts * 1_000_000) / sample.timescale,
            duration: (sample.duration * 1_000_000) / sample.timescale,
            data: sample.data,
          }),
        );
      }
    };

    onReady(mp4File);
  });
}

export function decode(
  file: File,
  onProgress: (decodedVideo: DecodedVideo) => boolean,
): Promise<DecodedVideo> {
  return decodeInternal(
    file.name,
    async (mp4File: MP4File) => {
      const reader = new FileReader();
      reader.onload = function () {
        const result = this.result as MP4ArrayBuffer;
        if (result != null) {
          result.fileStart = 0;
          mp4File.appendBuffer(result);
        }
        mp4File.flush();
      };
      reader.readAsArrayBuffer(file);
    },
    onProgress,
  );
}

export function decodeStream(
  fileStream: FileStream,
  onProgress: (decodedVideo: DecodedVideo) => boolean,
): Promise<DecodedVideo> {
  return decodeInternal(
    'stream',
    async (mp4File: MP4File) => {
      let part = await fileStream.next();
      while (part.done === false) {
        const result = part.value.data.buffer as MP4ArrayBuffer;
        if (result != null) {
          result.fileStart = part.value.range.start;
          mp4File.appendBuffer(result);
        }
        mp4File.flush();
        part = await fileStream.next();
      }
    },
    onProgress,
  );
}
