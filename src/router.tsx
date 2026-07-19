import { createBrowserRouter } from 'react-router-dom';
import App from '@/App';
import Home from '@/pages/Home';
import Notes from '@/pages/Notes';
import RequireAuth from '@/components/RequireAuth';
import RouteError from '@/components/RouteError';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      {
        element: <RequireAuth />,
        children: [{ path: 'notes', element: <Notes /> }],
      },
    ],
  },
]);
