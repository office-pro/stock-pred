import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export default function ForbiddenPage(): JSX.Element {
  return (
    <Box sx={{ textAlign: 'center', mt: 8 }}>
      <Typography variant="h5" gutterBottom>
        Access denied
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Your account does not include this view. Ask an admin to grant access.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Back to dashboard
      </Button>
    </Box>
  );
}
