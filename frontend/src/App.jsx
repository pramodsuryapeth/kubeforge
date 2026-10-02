import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CreateProject from './pages/CreateProject.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Vault from './pages/Vault.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/vault" element={<Vault />} />
        </Routes>
      </main>
    </div>
  );
}
