import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import ConsolePage from '../../pages/ConsolePage'
import UserManagementPage from '../../pages/UserManagementPage'
import ApprovalFlowsPage from '../../pages/ApprovalFlowsPage'
import MonitorPage from '../../pages/MonitorPage'
import DataExportPage from '../../pages/DataExportPage'
import SettingsPage from '../../pages/SettingsPage'
import ModelCatalogPage from '../../pages/ModelCatalogPage'
import LogViewerPage from '../../pages/LogViewerPage'
import ContractTemplatesPage from '../../pages/ContractTemplatesPage'
import ModelUsagePage from '../../pages/ModelUsagePage'
import FeedbackAdminPage from '../../pages/FeedbackAdminPage'

interface AdminRoutesProps {
  defaultRoute: string
}

export default function AdminRoutes({ defaultRoute }: AdminRoutesProps) {
  const { hasPermission } = useAuth()

  return (
    <Routes>
      <Route path="/admin" element={<Navigate to={defaultRoute} replace />} />
      <Route path="/admin/console" element={hasPermission('management:console') ? <ConsolePage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/users" element={hasPermission('user:read') ? <UserManagementPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/approval-flows" element={hasPermission('settings:edit') ? <ApprovalFlowsPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/monitor" element={hasPermission('monitor:read') ? <MonitorPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/data" element={hasPermission('data:export') ? <DataExportPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/settings" element={hasPermission('settings:edit') ? <SettingsPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/models" element={hasPermission('ai:manage_shared') ? <ModelCatalogPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/logs" element={hasPermission('log:read') ? <LogViewerPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/contract-templates" element={hasPermission('contract:create') ? <ContractTemplatesPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/model-usage" element={hasPermission('ai:manage_shared') ? <ModelUsagePage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="/admin/feedback" element={hasPermission('feedback:manage') ? <FeedbackAdminPage /> : <Navigate to={defaultRoute} replace />} />
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  )
}
