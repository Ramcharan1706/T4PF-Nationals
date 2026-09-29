import { type ReactNode } from "react";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import { RoleGuard } from "@/components/role-guard";
import {
  CaregiverDashboard,
  CaregiverMessages,
  ChildPractice,
  TonguePlacementPage,
  ChildProfile,
  CurriculumPage,
  LoginPage,
  PlansPage,
  PublicLanding,
  ReviewPage,
  TherapistDashboard,
} from "@/pages/SoundBuddyPages";

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={PublicLanding} />
        <Route path="/login" component={LoginPage} />
        <Route path="/app/therapist/dashboard">{() => <RoleGuard role="therapist"><TherapistDashboard /></RoleGuard>}</Route>
        <Route path="/app/therapist/children/:childId">{() => <RoleGuard role="therapist"><ChildProfile /></RoleGuard>}</Route>
        <Route path="/app/therapist/plans">{() => <RoleGuard role="therapist"><PlansPage /></RoleGuard>}</Route>
        <Route path="/app/therapist/library">{() => <RoleGuard role="therapist"><CurriculumPage /></RoleGuard>}</Route>
        <Route path="/app/therapist/review">{() => <RoleGuard role="therapist"><ReviewPage /></RoleGuard>}</Route>
        <Route path="/app/child/practice">{() => <RoleGuard role="child"><ChildPractice /></RoleGuard>}</Route>
        <Route path="/app/child/tongue-placement">{() => <RoleGuard role="child"><TonguePlacementPage /></RoleGuard>}</Route>
        <Route path="/app/caregiver/dashboard">{() => <RoleGuard role="caregiver"><CaregiverDashboard /></RoleGuard>}</Route>
        <Route path="/app/caregiver/messages">{() => <RoleGuard role="caregiver"><CaregiverMessages /></RoleGuard>}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}
