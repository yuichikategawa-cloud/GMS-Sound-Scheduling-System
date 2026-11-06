/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Authentication form workflows are owned by the Auth feature hook", async () => {
  const [app, actions, service, memberProfileActions, memberProfileService] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/auth/hooks/useAuthenticationActions.ts"),
    readRepoFile("src/features/auth/services/authentication.ts"),
    readRepoFile("src/features/auth/hooks/useMemberProfileActions.ts"),
    readRepoFile("src/features/auth/services/memberProfile.ts"),
  ]);

  assert(app.includes('import { useAuthenticationActions } from "./features/auth/hooks/useAuthenticationActions";'),
    "App must compose the Auth-owned action hook.");
  assert(app.includes("const authenticationActions = useAuthenticationActions({"),
    "App must supply auth mode and shared state setters.");
  for (const handler of ["submitAuth", "sendPasswordReset", "updateRecoveredPassword"]) {
    assert(!app.includes("async function " + handler + "("),
      "App must not retain Auth form workflow " + handler + ".");
    assert(actions.includes("async function " + handler + "("),
      "Auth action hook must own " + handler + ".");
  }
  assert(app.includes("onSubmitAuth={authenticationActions.submitAuth}") &&
    app.includes("onSendPasswordReset={authenticationActions.sendPasswordReset}") &&
    app.includes("onSubmit={authenticationActions.updateRecoveredPassword}"),
    "Auth screens must receive their callbacks through app composition.");

  for (const operation of [
    "registerAccount",
    "signInWithUsername",
    "sendPasswordResetLink",
    "updateAccountPassword",
  ]) {
    assert(actions.includes(operation) && service.includes("function " + operation + "("),
      "Auth hook must delegate " + operation + " to the Auth service.");
  }
  assert(!actions.includes("client.from(") && !actions.includes("client.rpc("),
    "Auth form workflow must not bypass the Auth service boundary.");
  assert(!actions.includes("startAuthSessionLifecycle"),
    "Auth form workflow must remain separate from session lifecycle management.");

  assert(app.includes('import { useMemberProfileActions } from "./features/auth/hooks/useMemberProfileActions";') &&
    app.includes("const memberProfileActions = useMemberProfileActions({"),
    "App must compose member-profile saving through the Auth feature hook.");
  assert(app.includes("onSave={memberProfileActions.saveProfile}") &&
    !app.includes("saveMemberProfile("),
    "App must pass the Auth-owned profile-save action without retaining persistence orchestration.");
  assert(memberProfileActions.includes("async function saveProfile(") &&
    memberProfileActions.includes("saveMemberProfile(client, userId, payload, currentEmail)") &&
    memberProfileActions.includes("await loadData()"),
    "The Auth profile hook must own save, feedback, and refresh orchestration.");
  assert(!/client\\.(?:rpc|from)\\(/.test(memberProfileActions),
    "The Auth profile action hook must delegate persistence to its service.");
  assert(memberProfileService.includes('from("member_profiles")') &&
    memberProfileService.includes('from("profiles")') &&
    memberProfileService.includes('from("servants")'),
    "The Auth profile persistence service must retain the existing member/profile/servant synchronization.");

  assert(app.includes("startAuthSessionLifecycle(supabase") &&
    app.includes("pushActions.cleanupForSignOut(userId)") &&
    app.includes("supabase.auth.signOut"),
    "App must retain session restoration and await push cleanup before local authentication sign-out.");

  for (const forbidden of [
    "features/availability/",
    "features/requests/",
    "features/notifications/",
    "features/statistics/",
    "features/audit/",
    "features/servants/",
    "features/schedule/",
  ]) {
    assert(!actions.includes(forbidden),
      "Auth action hook must not import another feature implementation: " + forbidden);
    assert(!memberProfileActions.includes(forbidden),
      "Auth member-profile hook must not import another feature implementation: " + forbidden);
  }
  assert(!actions.includes('/App"') && !actions.includes("/App'"),
    "Auth action hook must not depend on App.");
});
