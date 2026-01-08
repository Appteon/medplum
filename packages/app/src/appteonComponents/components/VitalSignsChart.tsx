'use client';

import { useState, useEffect } from 'react';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, ReferenceArea } from 'recharts';
import { Maximize2, X } from 'lucide-react';

interface VitalChartData {
  date: string;
  value: number;
  value2?: number;
}

interface VitalSignsChartProps {
  title: string;
  data: VitalChartData[];
  unit: string;
  minRange: number;
  maxRange: number;
  currentValue: string;
  compact?: boolean;
  minRange2?: number;
  maxRange2?: number;
  dataLabel?: string;
  dataLabel2?: string;
  chartType?: 'line' | 'bar' | 'groupedBar';
}

export function VitalSignsChart({
  title,
  data,
  unit,
  minRange,
  maxRange,
  currentValue,
  compact = false,
  minRange2,
  maxRange2,
  dataLabel,
  dataLabel2,
  chartType = 'bar',
}: VitalSignsChartProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isFullscreen]);

  const chartData = (data || []).slice(-5);
  const hasData = chartData && chartData.length > 0;
  const hasDualData = hasData && chartData.some((d) => d.value2 !== undefined);

  // Strip unit from currentValue if present (handles both "80 mmHg" and "120/80 mmHg" formats)
  const cleanCurrentValue = currentValue
    .replace(new RegExp(`\\s*${unit}\\s*`, 'gi'), '')
    .trim();

  const values = hasData ? chartData.map((d) => d.value) : [];
  const values2 = hasDualData ? chartData.map((d) => d.value2 || 0).filter((v) => v > 0) : [];
  const allValues = [...values, ...values2];

  const minValue = hasData ? Math.min(...allValues, minRange, minRange2 || minRange) : minRange;
  const maxValue = hasData ? Math.max(...allValues, maxRange, maxRange2 || maxRange) : maxRange;
  const padding = (maxValue - minValue) * 0.15;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-card border border-border rounded-lg p-2 shadow-lg">
          <p className="text-xs font-medium text-foreground">{dataPoint.date}</p>
          {hasDualData ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                {dataLabel || 'Primary'}: {dataPoint.value} {unit}
              </p>
              {dataPoint.value2 && (
                <p className="text-sm font-semibold text-foreground">
                  {dataLabel2 || 'Secondary'}: {dataPoint.value2} {unit}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-semibold text-foreground">
              {dataPoint.value} {unit}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const ChartContent = ({ height = 300 }: { height?: number }) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={hasData ? chartData : []}
        margin={{ top: 10, right: hasDualData ? 60 : 50, left: 5, bottom: compact ? 10 : 40 }}
        barGap={chartType === 'groupedBar' ? 2 : 4}
        barCategoryGap="20%"
      >
        <defs>
          <linearGradient id={`colorNormal-${title}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(211, 100%, 65%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(211, 100%, 65%)" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          vertical={false}
        />

        <XAxis
          dataKey="date"
          reversed={true}
          tick={{ fontSize: compact ? 10 : 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickLine={{ stroke: 'hsl(var(--border))' }}
        />

        <YAxis
          domain={[minValue - padding, maxValue + padding]}
          tick={{ fontSize: compact ? 10 : 12, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={(value) => Number(value).toFixed(0)}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickLine={{ stroke: 'hsl(var(--border))' }}
          label={
            compact
              ? undefined
              : { value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 12 } }
          }
        />

        <Tooltip content={<CustomTooltip />} />

        {/* Light-gray shaded areas above max and below min (out-of-range) */}
        <ReferenceArea
          y1={hasDualData && maxRange2 !== undefined ? Math.max(maxRange, maxRange2) : maxRange}
          y2={maxValue + padding}
          fill="hsl(0, 0%, 88%)"
          fillOpacity={0.3}
          ifOverflow="extendDomain"
        />
        <ReferenceArea
          y1={minValue - padding}
          y2={hasDualData && minRange2 !== undefined ? Math.min(minRange, minRange2) : minRange}
          fill="hsl(0, 0%, 88%)"
          fillOpacity={0.3}
          ifOverflow="extendDomain"
        />

        {/* Blue shaded normal range for primary metric */}
        <ReferenceArea
          y1={minRange}
          y2={maxRange}
          fill="hsl(211, 100%, 65%)"
          fillOpacity={0.1}
        />

        {/* Blue shaded normal range for secondary metric (if dual data) */}
        {hasDualData && minRange2 !== undefined && maxRange2 !== undefined && (
          <ReferenceArea
            y1={minRange2}
            y2={maxRange2}
            fill="hsl(190, 100%, 65%)"
            fillOpacity={0.1}
          />
        )}

        {/* Reference lines for thresholds */}
        <ReferenceLine
          y={maxRange}
          stroke="hsl(0, 0%, 39%)"
          strokeWidth={2}
          label={{
            value: 'High',
            position: 'right',
            fill: 'hsl(0, 0%, 39%)',
            fontSize: compact ? 9 : 11,
            fontWeight: 600,
            offset: 12,
          }}
        />

        <ReferenceLine
          y={minRange}
          stroke="hsl(0, 0%, 39%)"
          strokeWidth={2}
          label={{
            value: 'Low',
            position: 'right',
            fill: 'hsl(0, 0%, 39%)',
            fontSize: compact ? 9 : 11,
            fontWeight: 600,
            offset: 12,
          }}
        />

        {/* Second set of reference lines for dual data */}
        {hasDualData && minRange2 !== undefined && maxRange2 !== undefined && (
          <>
            <ReferenceLine
              y={maxRange2}
              stroke="hsl(0, 0%, 39%)"
              strokeWidth={2}
              label={{
                value: 'High',
                position: 'right',
                fill: 'hsl(0, 0%, 39%)',
                fontSize: compact ? 9 : 11,
                fontWeight: 600,
                offset: 12,
              }}
            />
            <ReferenceLine
              y={minRange2}
              stroke="hsl(0, 0%, 55%)"
              strokeWidth={2}
              label={{
                value: 'Low',
                position: 'right',
                fill: 'hsl(0, 0%, 55%)',
                fontSize: compact ? 9 : 11,
                fontWeight: 600,
                offset: 12,
              }}
            />
          </>
        )}

        {/* Main data bar */}
        {hasData && (
          <Bar
            dataKey="value"
            name={dataLabel || 'Value'}
            fill="hsl(210, 70%, 55%)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            barSize={chartType === 'groupedBar' ? 24 : 28}
          />
        )}

        {/* Second data bar for dual data (grouped bar for BP) */}
        {hasDualData && chartType === 'groupedBar' && (
          <Bar
            dataKey="value2"
            name={dataLabel2 || 'Value 2'}
            fill="hsl(40, 85%, 60%)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            barSize={24}
          />
        )}

        {/* No data overlay */}
        {!hasData && (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="hsl(var(--muted-foreground))"
            fontSize={compact ? 12 : 14}
            fontWeight="500"
          >
            Data not recorded in EMR
          </text>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className={compact ? '' : 'emr-medical-card'}>
        <div className={compact ? 'mb-1' : 'mb-4'}>
          <div className="flex items-start justify-between">
            <div className="flex-1 pl-3">
              <h3 className={`font-semibold text-foreground uppercase tracking-wide ${compact ? 'text-xs' : 'text-sm'}`}>
                {title}
              </h3>
              {!compact && hasData && (
                <>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    {cleanCurrentValue} <span className="text-sm text-muted-foreground ml-1">{unit}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Normal Range: {hasDualData && minRange2 !== undefined && maxRange2 !== undefined
                      ? `${dataLabel || 'Sys'}: ${minRange}-${maxRange}, ${dataLabel2 || 'Dia'}: ${minRange2}-${maxRange2}`
                      : `${minRange}-${maxRange}`} {unit}
                  </p>
                </>
              )}
              {!compact && !hasData && (
                <p className="text-xs text-muted-foreground mt-1">No data recorded in EMR</p>
              )}
            </div>
            {!compact && (
              <div className="ml-3 flex flex-col items-end text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-1 rounded" style={{ backgroundColor: 'hsl(0, 0%, 39%)' }} />
                  <span>High</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-1 rounded" style={{ backgroundColor: 'hsl(0, 0%, 39%)' }} />
                  <span>Low</span>
                </div>
              </div>
            )}
            {compact && (
              <button
                onClick={() => setIsFullscreen(true)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
                aria-label="Fullscreen"
              >
                <Maximize2 className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {compact && (
            <div className="pl-3">
              <p className={`text-base font-bold text-foreground mt-0.5 ${!hasData ? 'text-muted-foreground' : ''}`}>
                {hasData ? cleanCurrentValue : 'N/A'} <span className="text-xs text-muted-foreground ml-1">{unit}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Normal: {hasDualData && minRange2 !== undefined && maxRange2 !== undefined
                  ? `${dataLabel || 'Sys'}: ${minRange}-${maxRange}, ${dataLabel2 || 'Dia'}: ${minRange2}-${maxRange2}`
                  : `${minRange}-${maxRange}`} {unit}
              </p>
            </div>
          )}
        </div>

        <ChartContent height={compact ? 280 : 300} />
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-6xl max-h-[90vh] bg-card rounded-lg shadow-2xl border border-border flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Normal Range: {hasDualData && minRange2 !== undefined && maxRange2 !== undefined
                    ? `${dataLabel || 'Sys'}: ${minRange}-${maxRange}, ${dataLabel2 || 'Dia'}: ${minRange2}-${maxRange2}`
                    : `${minRange}-${maxRange}`} {unit}
                </p>
              </div>
                <div className="ml-4 flex flex-col items-end text-sm text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-1 rounded" style={{ backgroundColor: 'hsl(0, 0%, 39%)' }} />
                    <span>High</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-1 rounded" style={{ backgroundColor: 'hsl(0, 0%, 39%)' }} />
                    <span>Low</span>
                  </div>
                </div>
              <button
                onClick={() => setIsFullscreen(false)}
                className="p-2 rounded-md hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {hasData ? (
                <div className="h-[600px]">
                  <ChartContent height={600} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px]">
                  <p className="text-muted-foreground">No data recorded in EMR</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-2 text-sm font-medium text-background bg-primary hover:bg-primary/90 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
