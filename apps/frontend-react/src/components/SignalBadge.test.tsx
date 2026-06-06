import { render, screen } from '@testing-library/react';
import SignalBadge from './SignalBadge';

describe('SignalBadge', () => {
  it('renders BUY in success color', () => {
    render(<SignalBadge signal="BUY" />);
    expect(screen.getByTestId('signal-BUY')).toHaveTextContent('BUY');
  });

  it('renders SELL and HOLD variants', () => {
    render(<SignalBadge signal="SELL" />);
    expect(screen.getByTestId('signal-SELL')).toHaveTextContent('SELL');
    render(<SignalBadge signal="HOLD" />);
    expect(screen.getByTestId('signal-HOLD')).toHaveTextContent('HOLD');
  });
});
