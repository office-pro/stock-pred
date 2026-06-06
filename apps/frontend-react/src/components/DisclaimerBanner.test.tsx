import { render, screen } from '@testing-library/react';
import DisclaimerBanner from './DisclaimerBanner';

describe('DisclaimerBanner', () => {
  it('always shows the compliance disclaimer', () => {
    render(<DisclaimerBanner />);
    expect(screen.getByTestId('disclaimer-banner')).toHaveTextContent(
      'This is not investment advice.',
    );
    expect(screen.getByTestId('disclaimer-banner')).toHaveTextContent(
      'Paper trading is enabled by default',
    );
  });
});
