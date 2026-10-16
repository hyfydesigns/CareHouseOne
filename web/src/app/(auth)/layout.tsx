export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">
          <span className="mark" aria-hidden="true">C1</span>CareHouse One
        </div>
        {children}
      </div>
    </main>
  );
}
