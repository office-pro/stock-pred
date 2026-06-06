import { HttpException, Injectable } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { getEnv } from '@stockpred/shared-utils';

export type ServiceName =
  | 'auth'
  | 'marketData'
  | 'signalEngine'
  | 'patternEngine'
  | 'mlEngine'
  | 'backtest'
  | 'autoTrader'
  | 'notifications';

/** Thin HTTP fan-out to internal services with consistent error mapping. */
@Injectable()
export class ProxyService {
  private readonly urls: Record<ServiceName, string> = {
    auth: getEnv('AUTH_SERVICE_URL', 'http://localhost:3001'),
    marketData: getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002'),
    signalEngine: getEnv('SIGNAL_ENGINE_URL', 'http://localhost:3003'),
    patternEngine: getEnv('PATTERN_ENGINE_URL', 'http://localhost:3004'),
    backtest: getEnv('BACKTEST_SERVICE_URL', 'http://localhost:3005'),
    autoTrader: getEnv('AUTO_TRADER_URL', 'http://localhost:3006'),
    notifications: getEnv('NOTIFICATION_SERVICE_URL', 'http://localhost:3007'),
    mlEngine: getEnv('ML_ENGINE_URL', 'http://localhost:8000'),
  };

  async get<T>(service: ServiceName, path: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>(service, { ...config, method: 'GET', url: path });
  }

  async post<T>(
    service: ServiceName,
    path: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.request<T>(service, { ...config, method: 'POST', url: path, data: body });
  }

  private async request<T>(service: ServiceName, config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await axios.request<T>({
        baseURL: this.urls[service],
        timeout: 30_000,
        ...config,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new HttpException(
          axiosError.response.data as Record<string, unknown>,
          axiosError.response.status,
        );
      }
      throw new HttpException(
        { message: `Upstream service "${service}" is unavailable`, statusCode: 502 },
        502,
      );
    }
  }
}
