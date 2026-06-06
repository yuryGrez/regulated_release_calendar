/**
 * Auth0 Post-Login Action
 * ========================
 * Injects the RRC tenant_id into the access token as a custom claim.
 *
 * Deploy steps:
 *   1. Auth0 Dashboard → Actions → Library → Create Action
 *   2. Trigger: Login / Post Login
 *   3. Paste this file as the action code
 *   4. Add to the Login flow
 *
 * User metadata required:
 *   app_metadata.rrc_tenant_id — set when provisioning a new tenant
 *   app_metadata.rrc_role      — 'admin' | 'user' (optional, defaults to 'user')
 *
 * The custom claim namespace must match AUTH0_NAMESPACE in .env:
 *   https://rrc.dev/tenant_id
 *   https://rrc.dev/role
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://rrc.dev';

  const tenantId = event.user.app_metadata?.rrc_tenant_id;
  const role     = event.user.app_metadata?.rrc_role ?? 'user';

  if (!tenantId) {
    // Reject login if user has no tenant — prevents unauthenticated access
    api.access.deny(`User ${event.user.user_id} has no rrc_tenant_id in app_metadata`);
    return;
  }

  // Add to access token (consumed by the API gateway)
  api.accessToken.setCustomClaim(`${namespace}/tenant_id`, tenantId);
  api.accessToken.setCustomClaim(`${namespace}/role`,      role);

  // Add to ID token (consumed by the frontend)
  api.idToken.setCustomClaim(`${namespace}/tenant_id`, tenantId);
  api.idToken.setCustomClaim(`${namespace}/role`,      role);
};
