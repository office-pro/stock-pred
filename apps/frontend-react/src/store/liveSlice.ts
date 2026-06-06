import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Tick } from '@stockpred/shared-types';

export interface LiveSignal {
  symbol: string;
  signal: 'BUY' | 'SELL';
  confidence: number;
  price: number;
  target: number;
  stopLoss: number;
  generatedAt: number;
}

interface LiveState {
  /** Latest tick per symbol (stocks and indices). */
  ticks: Record<string, Tick>;
  /** Rolling feed of realtime signals (latest first, capped). */
  signalFeed: LiveSignal[];
  connected: boolean;
}

const initialState: LiveState = {
  ticks: {},
  signalFeed: [],
  connected: false,
};

const MAX_FEED = 50;

const liveSlice = createSlice({
  name: 'live',
  initialState,
  reducers: {
    socketConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload;
    },
    tickReceived: (state, action: PayloadAction<Tick>) => {
      state.ticks[action.payload.symbol] = action.payload;
    },
    signalReceived: (state, action: PayloadAction<LiveSignal>) => {
      state.signalFeed.unshift(action.payload);
      if (state.signalFeed.length > MAX_FEED) state.signalFeed.pop();
    },
  },
});

export const { socketConnected, tickReceived, signalReceived } = liveSlice.actions;
export default liveSlice.reducer;
