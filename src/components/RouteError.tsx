import { useRouteError } from 'react-router-dom';
import ErrorFallback from './ErrorFallback';

function RouteError() {
  const error = useRouteError();
  return <ErrorFallback error={error} />;
}

export default RouteError;
