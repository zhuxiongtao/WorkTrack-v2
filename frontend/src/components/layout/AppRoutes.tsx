import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import ReportHubPage from '../../pages/ReportHubPage'
import ProjectsPage from '../../pages/ProjectsPage'
import MeetingsPage from '../../pages/MeetingsPage'
import AIPage from '../../pages/AIPage'
import SettingsPage from '../../pages/SettingsPage'
import ScheduledTasksPage from '../../pages/ScheduledTasksPage'
import CustomersPage from '../../pages/CustomersPage'
import ContractsPage from '../../pages/ContractsPage'
import DashboardPage from '../../pages/DashboardPage'
import WikiPage from '../../pages/WikiPage'
import PublicWikiPage from '../../pages/PublicWikiPage'
import SharedWithMePage from '../../pages/SharedWithMePage'
import ProjectCostPage from '../../pages/ProjectCostPage'
import UpstreamPage from '../../pages/UpstreamPage'
import ReconcilePage from '../../pages/ReconcilePage'
import ApprovalsPage from '../../pages/ApprovalsPage'
import ModelChangePage from '../../pages/ModelChangePage'
import TeamManagementPage from '../../pages/TeamManagementPage'

interface AppRoutesProps {
  homePage: string
}

function AppRoutes({ homePage }: AppRoutesProps) {
  const { hasPermission } = useAuth()

  return (
    <Routes>
      <Route path="/" element={<Navigate to={homePage} replace />} />
      <Route path="/dashboard"     element={hasPermission('dashboard:read') ? <DashboardPage />    : <Navigate to={homePage} replace />} />
      <Route path="/reports"       element={hasPermission('report:read')    ? <ReportHubPage />    : <Navigate to={homePage} replace />} />
      <Route path="/team"          element={hasPermission('user:read')      ? <TeamManagementPage /> : <Navigate to={homePage} replace />} />
      <Route path="/meetings"      element={hasPermission('meeting:read')   ? <MeetingsPage />     : <Navigate to={homePage} replace />} />
      <Route path="/approvals"     element={<ApprovalsPage />} />
      <Route path="/tasks"         element={hasPermission('task:read')      ? <ScheduledTasksPage /> : <Navigate to={homePage} replace />} />
      <Route path="/projects"      element={hasPermission('project:read')   ? <ProjectsPage />     : <Navigate to={homePage} replace />} />
      <Route path="/project-costs" element={hasPermission('project:read')   ? <ProjectCostPage />  : <Navigate to={homePage} replace />} />
      <Route path="/upstream"      element={hasPermission('upstream:read')  ? <UpstreamPage />     : <Navigate to={homePage} replace />} />
      <Route path="/suppliers"     element={<Navigate to="/upstream" replace />} />
      <Route path="/channels"      element={<Navigate to="/upstream" replace />} />
      <Route path="/reconcile"     element={hasPermission('reconcile:read') ? <ReconcilePage />    : <Navigate to={homePage} replace />} />
      <Route path="/model-changes" element={hasPermission('model:read') ? <ModelChangePage /> : <Navigate to={homePage} replace />} />
      <Route path="/customers"     element={hasPermission('customer:read')  ? <CustomersPage />    : <Navigate to={homePage} replace />} />
      <Route path="/contracts"     element={hasPermission('contract:read')  ? <ContractsPage />    : <Navigate to={homePage} replace />} />
      <Route path="/wiki"          element={hasPermission('wiki:read')      ? <WikiPage />         : <Navigate to={homePage} replace />} />
      <Route path="/wiki/:spaceId" element={hasPermission('wiki:read')      ? <WikiPage />         : <Navigate to={homePage} replace />} />
      <Route path="/wiki/public/:spaceId/:pageId" element={<PublicWikiPage />} />
      <Route path="/shared"        element={hasPermission('share:read')     ? <SharedWithMePage /> : <Navigate to={homePage} replace />} />
      <Route path="/ai"            element={hasPermission('ai:use')         ? <AIPage />           : <Navigate to={homePage} replace />} />
      <Route path="/settings"      element={<SettingsPage />} />

      {/* 老路径兼容：admin 页面已迁移至 /admin/*，直接跳转 */}
      <Route path="/console"        element={<Navigate to="/admin/console"        replace />} />
      <Route path="/users"          element={<Navigate to="/admin/users"          replace />} />
      <Route path="/approval-flows" element={<Navigate to="/admin/approval-flows" replace />} />
      <Route path="/monitor"        element={<Navigate to="/admin/monitor"        replace />} />
      <Route path="/data"           element={<Navigate to="/admin/data"           replace />} />
      <Route path="/models"         element={<Navigate to="/admin/models"         replace />} />
      <Route path="/logs"           element={<Navigate to="/admin/logs"           replace />} />

      {/* 兜底 */}
      <Route path="*" element={<Navigate to={homePage} replace />} />
    </Routes>
  )
}

export default AppRoutes
