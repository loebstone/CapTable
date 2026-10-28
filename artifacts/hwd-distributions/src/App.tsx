import { type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetSession, getGetSessionQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import SignIn, { AdminSignIn } from '@/pages/sign-in';
import { isReauthentication, reportReauthentication, ReauthenticationMessage, ReauthenticationPrompt } from '@/components/reauthenticate';
import HoldingsPage from '@/pages/holdings';
import HomePage from '@/pages/home';
import { SnapshotsPage, SnapshotDetailPage } from '@/pages/snapshots';
import ResidencesPage from '@/pages/residences';
import RatesPage from '@/pages/rates';
import AccessPage from '@/pages/access';
import AuditPage from '@/pages/audit';
import YearsPage from '@/pages/years';
import YearDetailPage from '@/pages/year-detail';
import MailingPage from '@/pages/mailing';
import DirectionsPage from '@/pages/directions';
import SignDirectionPage from '@/pages/sign-direction';
import { Shell } from '@/components/shell';
import { ErrorPanel } from '@/components/bits';
import { isAuthError } from '@/lib/format';

const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({ onError: reportReauthentication }),
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (isReauthentication(err)) { reportReauthentication(err); return; }
      // Any data route rejecting the session sends us back to sign-in.
      if (isAuthError(err) && query.queryKey[0] !== getGetSessionQueryKey()[0]) {
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      }
    },
  }),
  defaultOptions: {
    queries: { retry: (n, err) => !isAuthError(err) && n < 2, refetchOnWindowFocus: false },
  },
});

function Gate() {
  const session = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: false } });
  if (session.isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="font-display animate-pulse text-xl text-muted-foreground">HWD Cap Table</div>
      </div>
    );
  }
  if (session.isError && isReauthentication(session.error)) return <ReauthenticationMessage />;
  if (session.isError && !isAuthError(session.error)) {
    return <div className="mx-auto max-w-lg px-6 py-24"><ErrorPanel error={session.error} onRetry={() => session.refetch()} /></div>;
  }
  if (!session.data || session.isError) return <SignIn />;
  return (
    <Shell session={session.data}>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/holdings" component={HoldingsPage} />
          <Route path="/snapshots" component={SnapshotsPage} />
          <Route path="/snapshots/:id" component={SnapshotDetailPage} />
          <Route path="/residences" component={ResidencesPage} />
          <Route path="/rates" component={RatesPage} />
          <Route path="/access" component={AccessPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/years" component={YearsPage} />
          <Route path="/years/:id/mailing" component={MailingPage} />
          <Route path="/years/:id/directions" component={DirectionsPage} />
          <Route path="/years/:id" component={YearDetailPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/sign-direction" component={SignDirectionPage} />
            <Route path="/admin/sign-in" component={AdminSignIn} />
            <Route component={Gate} />
          </Switch>
        </WouterRouter>
        <Toaster />
        <ReauthenticationPrompt />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
