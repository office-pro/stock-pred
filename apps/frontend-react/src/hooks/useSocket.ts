import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Tick } from '@stockpred/shared-types';
import { API_BASE_URL } from '../config';
import { useAppDispatch } from '../store';
import { LiveSignal, signalReceived, socketConnected, tickReceived } from '../store/liveSlice';

let socket: Socket | null = null;

/** Realtime feed: stock:update / signal:update / prediction:update / trade:update. */
export function useSocket(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!socket) {
      socket = io(API_BASE_URL, { transports: ['websocket'], reconnectionDelayMax: 10_000 });
    }
    const current = socket;

    const onConnect = (): void => {
      dispatch(socketConnected(true));
    };
    const onDisconnect = (): void => {
      dispatch(socketConnected(false));
    };
    const onTick = (tick: Tick): void => {
      dispatch(tickReceived(tick));
    };
    const onSignal = (signal: LiveSignal): void => {
      dispatch(signalReceived(signal));
    };

    current.on('connect', onConnect);
    current.on('disconnect', onDisconnect);
    current.on('stock:update', onTick);
    current.on('signal:update', onSignal);

    return () => {
      current.off('connect', onConnect);
      current.off('disconnect', onDisconnect);
      current.off('stock:update', onTick);
      current.off('signal:update', onSignal);
    };
  }, [dispatch]);
}
