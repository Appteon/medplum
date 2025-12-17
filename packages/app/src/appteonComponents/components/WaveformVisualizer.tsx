import { useEffect, useState } from 'react';

export const WaveformVisualizer = () => {
  const [bars, setBars] = useState<number[]>(Array(20).fill(0.3));

  useEffect(() => {
    const interval = setInterval(() => {
      setBars(prev => prev.map(() => 0.2 + Math.random() * 0.8));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-center gap-1 h-12 px-4 mt-4">
      {bars.map((height, index) => (
        <div
          key={index}
          className="emr-waveform-bar w-1 rounded-full transition-all duration-100"
          style={{ 
            height: `${height * 100}%`,
            animationDelay: `${index * 0.05}s`
          }}
        />
      ))}
    </div>
  );
};
