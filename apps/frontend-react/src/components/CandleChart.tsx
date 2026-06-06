import { Box } from '@mui/material';
import {
  ColorType,
  createChart,
  IChartApi,
  LineStyle,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Candle, SupportResistance } from '@stockpred/shared-types';

export interface ChartSignalMarker {
  time: number;
  signal: 'BUY' | 'SELL';
  text: string;
}

interface CandleChartProps {
  candles: Candle[];
  supportResistance?: SupportResistance | null;
  /** Latest actionable levels to draw (target / stop-loss). */
  target?: number | null;
  stopLoss?: number | null;
  markers?: ChartSignalMarker[];
  /** Normalized benchmark overlay for comparison mode. */
  comparison?: { name: string; candles: Candle[] } | null;
  height?: number;
}

/** Candlestick + volume chart (TradingView lightweight-charts). */
export default function CandleChart({
  candles,
  supportResistance,
  target,
  stopLoss,
  markers,
  comparison,
  height = 480,
}: CandleChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return undefined;

    const chart = createChart(container, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa4bb',
      },
      grid: {
        vertLines: { color: 'rgba(154, 164, 187, 0.08)' },
        horzLines: { color: 'rgba(154, 164, 187, 0.08)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const toTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

    // ---- candles
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeries.setData(
      candles.map((c) => ({
        time: toTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // ---- volume
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles.map((c) => ({
        time: toTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
      })),
    );

    // ---- support / resistance price lines
    for (const level of supportResistance?.support ?? []) {
      candleSeries.createPriceLine({
        price: level,
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'S',
      });
    }
    for (const level of supportResistance?.resistance ?? []) {
      candleSeries.createPriceLine({
        price: level,
        color: '#ef5350',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'R',
      });
    }

    // ---- target / stop-loss
    if (target != null) {
      candleSeries.createPriceLine({
        price: target,
        color: '#4f8cff',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Target',
      });
    }
    if (stopLoss != null) {
      candleSeries.createPriceLine({
        price: stopLoss,
        color: '#ff9800',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Stop',
      });
    }

    // ---- buy/sell markers
    if (markers && markers.length > 0) {
      const seriesMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
        time: toTime(m.time),
        position: m.signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color: m.signal === 'BUY' ? '#26a69a' : '#ef5350',
        shape: m.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: m.text,
      }));
      candleSeries.setMarkers(seriesMarkers);
    }

    // ---- comparison overlay (normalized to the stock's first close)
    if (comparison && comparison.candles.length > 1) {
      const base = candles[0].close;
      const benchBase = comparison.candles[0].close;
      const overlay = chart.addLineSeries({
        color: '#ab8cff',
        lineWidth: 2,
        priceLineVisible: false,
        title: comparison.name,
      });
      overlay.setData(
        comparison.candles.map((c) => ({
          time: toTime(c.time),
          value: (c.close / benchBase) * base,
        })),
      );
    }

    chart.timeScale().fitContent();

    const onResize = (): void => {
      chart.applyOptions({ width: container.clientWidth });
    };
    onResize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, supportResistance, target, stopLoss, markers, comparison, height]);

  return <Box ref={containerRef} sx={{ width: '100%' }} data-testid="candle-chart" />;
}
