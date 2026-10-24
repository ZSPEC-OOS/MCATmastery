import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import HomeDashboard from "../components/HomeDashboard";

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <HomeDashboard />
      <Footer />
    </div>
  );
}
