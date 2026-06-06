import { render, screen } from '@testing-library/react';
import ChangeCell from './ChangeCell';

describe('ChangeCell', () => {
  it('prefixes positive values with +', () => {
    render(<ChangeCell value={1.234} />);
    expect(screen.getByText('+1.23%')).toBeInTheDocument();
  });

  it('shows negative values as-is', () => {
    render(<ChangeCell value={-2.5} />);
    expect(screen.getByText('-2.50%')).toBeInTheDocument();
  });

  it('supports custom suffixes', () => {
    render(<ChangeCell value={5} suffix=" pts" />);
    expect(screen.getByText('+5.00 pts')).toBeInTheDocument();
  });
});
