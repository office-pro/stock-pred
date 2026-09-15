/**
 * Sector Overview — backend sector list + optional detail. No FE sector invent.
 */
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link as RouterLink } from 'react-router-dom';
import { useGetIntelligenceSectorsQuery, useGetSectorIntelligenceQuery } from '../store/api';
import { useState } from 'react';

function SectorDetail({ sector }: { sector: string }): JSX.Element {
  const { data, isFetching } = useGetSectorIntelligenceQuery(sector);
  if (isFetching) return <CircularProgress size={18} />;
  if (!data || data.status !== 'AVAILABLE') {
    return (
      <Typography variant="body2">
        Sector intelligence Not available
        {data?.reason ? ` (${data.reason})` : ''}.
      </Typography>
    );
  }
  return (
    <Box>
      <Chip size="small" label={data.state ?? 'UNKNOWN'} sx={{ mb: 1 }} />
      <Typography variant="body2">
        Coverage symbols: {data.coverageSymbols ?? 'Not available'}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        <RouterLink to={`/batch`}>Open Batch Center for sector stocks →</RouterLink>
      </Typography>
    </Box>
  );
}

export default function SectorOverviewPage(): JSX.Element {
  const { data, isLoading, isError } = useGetIntelligenceSectorsQuery();
  const [open, setOpen] = useState<string | false>(false);

  return (
    <Box sx={{ p: 2, maxWidth: 900 }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Sectors
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Sector state is advisory context from backend canonical metadata. It does not rank or
        authorize trades.
      </Alert>
      {isLoading ? <CircularProgress size={24} /> : null}
      {isError ? <Alert severity="warning">Sector list Not available.</Alert> : null}
      {(data?.sectors ?? []).map((s) => (
        <Accordion
          key={s.sector}
          expanded={open === s.sector}
          onChange={(_, exp) => setOpen(exp ? s.sector : false)}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600} sx={{ flex: 1 }}>
              {s.sector}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {s.memberCount} stocks
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {open === s.sector ? <SectorDetail sector={s.sector} /> : null}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
