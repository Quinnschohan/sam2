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
import ClearAllPointsInVideoButton from '@/common/components/annotations/ClearAllPointsInVideoButton';
import CloseSessionButton from '@/common/components/annotations/CloseSessionButton';
import QuickSegmentationToggle from '@/common/components/annotations/QuickSegmentationToggle';
import TrackAndPlayButton from '@/common/components/button/TrackAndPlayButton';
import ToolbarBottomActionsWrapper from '@/common/components/toolbar/ToolbarBottomActionsWrapper';
import {
  EFFECT_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import {quickTestModeAtom, streamingStateAtom} from '@/demo/atoms';
import {useAtom, useAtomValue} from 'jotai';
import {Toggle} from 'react-daisyui';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function ObjectsToolbarBottomActions({onTabChange}: Props) {
  const streamingState = useAtomValue(streamingStateAtom);
  const [quickTestMode, setQuickTestMode] = useAtom(quickTestModeAtom);

  const isTrackingEnabled =
    streamingState !== 'none' && streamingState !== 'full';

  function handleSwitchToEffectsTab() {
    onTabChange(EFFECT_TOOLBAR_INDEX);
  }

  return (
    <ToolbarBottomActionsWrapper>
      <ClearAllPointsInVideoButton
        onRestart={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
      />
      {!isTrackingEnabled && streamingState !== 'full' && (
        <QuickSegmentationToggle />
      )}
      {isTrackingEnabled && (
        <div className="form-control flex flex-row items-center gap-2">
          <label className="label cursor-pointer p-0">
            <span className="label-text text-xs whitespace-nowrap">Quick Test (10 frames)</span> 
          </label>
          <Toggle 
            checked={quickTestMode}
            onChange={(e) => setQuickTestMode(e.target.checked)}
            size="sm"
          />
        </div>
      )}
      {isTrackingEnabled && <TrackAndPlayButton />}
      {streamingState === 'full' && (
        <CloseSessionButton onSessionClose={handleSwitchToEffectsTab} />
      )}
    </ToolbarBottomActionsWrapper>
  );
}
