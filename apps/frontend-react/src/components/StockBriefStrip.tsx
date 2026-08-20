import { Box, Typography } from '@mui/material';
import { buildStockBrief, type StockBriefInput } from '../lib/stock-brief';

export default function StockBriefStrip(props: StockBriefInput): JSX.Element | null {
  const { contextLine, decisionLine } = buildStockBrief(props);

  return (
    <Box
      sx={{
        mb: 1.5,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: 'action.hover',
        borderLeft: 3,
        borderColor:
          props.paperAction === 'BUY'
            ? 'success.main'
            : props.paperAction === 'SELL'
              ? 'error.main'
              : 'info.main',
      }}
      data-testid="stock-brief-strip"
    >
      <Typography variant="body2" color="text.primary" sx={{ mb: 0.5 }}>
        {contextLine}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {decisionLine}
      </Typography>
    </Box>
  );
}
