import { memo } from 'react';
import Dither from '../Dither/Dither';
import './Background.css';

/*
 * Fixed full-screen animated dithered-wave background.
 * Memoized so parent re-renders (auth state, modal toggles) never
 * tear down or interrupt the WebGL canvas.
 */
function Background({ dim = false }) {
  return (
    <div className={dim ? 'dither-bg dither-bg--dim' : 'dither-bg'}>
      <Dither
        waveColor={[0.42, 0.42, 0.42]}
        disableAnimation={false}
        enableMouseInteraction
        mouseRadius={0.35}
        colorNum={4}
        pixelSize={2}
        waveAmplitude={0.35}
        waveFrequency={3}
        waveSpeed={0.08}
      />
    </div>
  );
}

export default memo(Background);
