import './globals.css';

export const metadata = {
  title: 'RED.Health City Performance Dashboard',
  description: 'Citywise KPI performance dashboard for RED.Health ambulance services',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
