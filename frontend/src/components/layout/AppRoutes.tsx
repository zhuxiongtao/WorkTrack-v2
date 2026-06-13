import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import ReportHubPage from '../../pages/ReportHubPage'
import ProjectsPage from '../../pages/ProjectsPage'
import MeetingsPage from '../../pages/MeetingsPage'
import AIPage from '../../pages/AIPage'
import SettingsPage from '../../pages/SettingsPage'
import ScheduledTasksPage from '../../pages/ScheduledTasksPage'
import LogViewerPage from '../../pages/LogViewerPage'
import CustomersPage from '../../pages/CustomersPage'
import ContractsPage from '../../pages/ContractsPage'
import UserManagementPage from '../../pages/UserManagementPage'
import DashboardPage from '../../pages/DashboardPage'
import WikiPage from '../../pages/WikiPage'
import PublicWikiPage from '../../pages/PublicWikiPage'
import MonitorPage from '../../pages/MonitorPage'
import DataExportPage from '../../pages/DataExportPage'
import ConsolePage from '../../pages/ConsolePage'
import SharedWithMePage from '../../pages/SharedWithMePage'
import ProjectCostPage from '../../pages/ProjectCostPage'
import SuppliersPage from '../../pages/SuppliersPage'
import ChannelsPage from '../../pages/ChannelsPage'
import ReconcilePage from '../../pages/ReconcilePage'

interface AppRoutesProps {
  homePage: string
}

function AppRoutes({ homePage }: AppRoutesProps) {
  const { hasPermission, isAdmin } = useAuth()

  return (
    <Routes>
      <Route path="/" element={<Navigate to={homePage} replace />} />
      <Route path="/reports" element={hasPermission('report:read') ? <ReportHubPage /> : <Navigate to={homePage} replace />} />
      <Route path="/projects" element={hasPermission('project:read') ? <ProjectsPage /> : <Navigate to={homePage} replace />} />
      <Route path="/meetings" element={hasPermission('meeting:read') ? <MeetingsPage /> : <Navigate to={homePage} replace />} />
      <Route path="/ai" element={hasPermission('ai:use') ? <AIPage /> : <Navigate to={homePage} replace />} />
      <Route path="/customers" element={hasPermission('customer:read') ? <CustomersPage /> : <Navigate to={homePage} replace />} />
      <Route path="/contracts" element={hasPermission('contract:read') ? <ContractsPage /> : <Navigate to={homePage} replace />} />
      <Route path="/tasks" element={hasPermission('task:read') ? <ScheduledTasksPage /> : <Navigate to={homePage} replace />} />
      <Route path="/logs" element={hasPermission('log:read') ? <LogViewerPage /> : <Navigate to={homePage} replace />} />
      <Route path="/monitor" element={hasPermission('monitor:read') ? <MonitorPage /> : <Navigate to={homePage} replace />} />
      <Route path="/data" element={hasPermission('data:export') ? <DataExportPage /> : <Navigate to={homePage} replace />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/users" element={isAdmin ? <UserManagementPage /> : <Navigate to={homePage} replace />} />
      <Route path="/dashboard" element={hasPermission('dashboard:read') ? <DashboardPage /> : <Navigate to={homePage} replace />} />
      <Route path="/wiki" element={hasPermission('wiki:read') ? <WikiPage /> : <Navigate to={homePage} replace />} />
      <Route path="/wiki/:spaceId" element={hasPermission('wiki:read') ? <WikiPage /> : <Navigate to={homePage} replace />} />
      <Route path="/wiki/public/:spaceId/:pageId" element={<PublicWikiPage />} />
      <Route path="/console" element={hasPermission('management:console') ? <ConsolePage /> : <Navigate to={homePage} replace />} />
      <Route path="/shared" element={hasPermission('share:read') ? <SharedWithMePage /> : <Navigate to={homePage} replace />} />
      <Route path="/project-costs" element={hasPermission('project:read') ? <ProjectCostPage /> : <Navigate to={homePage} replace />} />
      <Route path="/suppliers" element={hasPermission('project:read') ? <SuppliersPage /> : <Navigate to={homePage} replace />} />
      <Route path="/channels" element={hasPermission('project:read') ? <ChannelsPage /> : <Navigate to={homePage} replace />} />
      <Route path="/reconcile" element={hasPermission('project:read') ? <ReconcilePage /> : <Navigate to={homePage} replace />} />
      {/* 兜底：未知路径重定向到首页，避免白屏 */}
      <Route path="*" element={<Navigate to={homePage} replace />} />
    </Routes>
  )
}

export default AppRoutes
