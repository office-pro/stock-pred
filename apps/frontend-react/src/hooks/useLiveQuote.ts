import { dayChangePercent, pickLiveQuote } from '../lib/paper-pnl';
import { useAppSelector } from '../store';
import { useGetStockQuery } from '../store/api';
import { useNseSession } from './useNseSession';

const LIVE_POLL_MS = 3_000;

/** Last listed trade for one symbol: polls while the page is open. */
export function useLiveQuote(symbol: string): {
  price: number;
  listedAt: number | null;
  previousClose?: number;
  changePercent?: number;
  isFetching: boolean;
  inSession: boolean;
  live: boolean;
} {
  const upper = symbol.toUpperCase();
  const inSession = useNseSession();
  const { data, isFetching } = useGetStockQuery(upper, {
    skip: !upper,
    pollingInterval: LIVE_POLL_MS,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const tick = useAppSelector((state) => state.live.ticks[upper]);
  const picked = pickLiveQuote({
    quotePrice: data?.price,
    quoteTime: data?.updatedAt,
    tickPrice: tick?.price,
    tickTime: tick?.time,
  });
  const changePercent =
    dayChangePercent(picked.price, data?.previousClose) ?? data?.changePercent ?? undefined;

  return {
    price: picked.price,
    listedAt: picked.listedAt,
    previousClose: data?.previousClose,
    changePercent,
    isFetching,
    inSession,
    live: inSession || isFetching,
  };
}
