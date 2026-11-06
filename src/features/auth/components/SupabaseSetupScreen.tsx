
export default function SupabaseSetupScreen() {
  return (
    <div className="auth-page">
      <div className="auth-card setup-card">
        <p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p>
        <h1>Connect your Supabase project</h1>
        <p className="subtle">The app is ready. Add your Supabase project credentials to enable shared login and scheduling.</p>
        <ol>
          <li>Create a Supabase project.</li>
          <li>Run <code>supabase/schema.sql</code> in the SQL Editor.</li>
          <li>Copy <code>.env.example</code> to <code>.env</code> and fill in your Project URL and anon/publishable key.</li>
          <li>Restart the development server.</li>
        </ol>
        <p className="message">No database password or service-role key is needed in this frontend.</p>
      </div>
    </div>
  );
}
