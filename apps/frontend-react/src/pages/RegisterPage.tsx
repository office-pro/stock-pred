import { Navigate } from 'react-router-dom';

/** Public registration is disabled — accounts are invite-only. */
export default function RegisterPage(): JSX.Element {
  return <Navigate to="/login" replace />;
}
