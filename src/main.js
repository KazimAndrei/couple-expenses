import './styles/app.css';
import { supabase, getSession, getProfile, authWithInviteCode } from './lib/supabase.js';
import { navigate, startRouter, getCurrentPath } from './lib/router.js';
import { setState } from './lib/store.js';
import { currentMonth } from './lib/utils.js';
import { registerServiceWorker } from './services/pwa.js';
import { exposeToastGlobally } from './services/toast.js';
import { registerAuthSetupRoutes } from './pages/auth-setup-page.js';
import { registerHomeRoute } from './pages/home-page.js';
import { registerAnalyticsRoute } from './pages/analytics-page.js';
import { registerGoalsRoute } from './pages/goals-page.js';
import { registerProfileRoute } from './pages/profile-page.js';

registerAuthSetupRoutes();
registerHomeRoute();
registerAnalyticsRoute();
registerGoalsRoute();
registerProfileRoute();

// ---- INIT ----
async function init() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  registerServiceWorker();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      const profile = await getProfile();
      if (profile?.couple_id) {
        setState({ user: session.user, profile, couple: profile.couples || null, currentMonth: currentMonth(), loading: false });
        if (getCurrentPath() === '/auth') navigate('/');
      }
    } else if (event === 'SIGNED_OUT') {
      setState({ user: null, profile: null, couple: null, loading: false });
      navigate('/auth');
    }
  });

  try {
    const session = await getSession();
    if (session?.user) {
      const profile = await getProfile();
      if (profile && profile.couple_id) {
        setState({ user: session.user, profile, couple: profile.couples || null, currentMonth: currentMonth(), loading: false });
        // User is logged in and has a couple — go to home
      } else if (profile && !profile.couple_id) {
        // User exists but no couple — check if we have saved invite code
        const savedCode = localStorage.getItem('ce_invite_code');
        const savedName = localStorage.getItem('ce_display_name');
        if (savedCode) {
          try {
            const couple = await authWithInviteCode(savedCode, savedName || 'User');
            const refreshedProfile = await getProfile();
            setState({ user: session.user, profile: refreshedProfile, couple: refreshedProfile?.couples || couple, currentMonth: currentMonth(), loading: false });
          } catch {
            setState({ loading: false });
            navigate('/auth');
          }
        } else {
          setState({ user: session.user, profile, couple: null, currentMonth: currentMonth(), loading: false });
          navigate('/auth');
        }
      } else {
        // No profile — create one
        const { error } = await supabase.from('profiles').upsert({
          id: session.user.id,
          display_name: localStorage.getItem('ce_display_name') || 'User',
        });
        if (error) console.error('Create profile error:', error);
        setState({ loading: false });
        navigate('/auth');
      }
    } else {
      // No session — check if we have saved credentials for auto-login
      const savedCode = localStorage.getItem('ce_invite_code');
      const savedName = localStorage.getItem('ce_display_name');
      if (savedCode) {
        try {
          const couple = await authWithInviteCode(savedCode, savedName || 'User');
          const newSession = await getSession();
          const profile = await getProfile();
          setState({ user: newSession?.user, profile, couple: profile?.couples || couple, currentMonth: currentMonth(), loading: false });
        } catch {
          setState({ loading: false });
          navigate('/auth');
        }
      } else {
        setState({ loading: false });
        navigate('/auth');
      }
    }
  } catch (err) {
    console.error('Init error:', err);
    setState({ loading: false });
    navigate('/auth');
  }

  startRouter();
}

exposeToastGlobally();
init();
