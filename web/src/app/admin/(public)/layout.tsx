export const metadata = { title: "Admin · CareHouse One" };

export default function AdminPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">
          <span className="mark" aria-hidden="true">C1</span>CareHouse One <span className="pill info" style={{ marginLeft: 8 }}>Admin</span>
        </div>
        {children}
      </div>
    </main>
  );
}
