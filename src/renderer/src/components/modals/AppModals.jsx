import OpenShiftModal from './OpenShiftModal'
import CloseShiftModal from './CloseShiftModal'
import CustomAlertModal from './CustomAlertModal'
import SupervisorApprovalModal from './SupervisorApprovalModal'
import ReturnRequestModal from './ReturnRequestModal'
import AddProductModal from './AddProductModal'
import EditProductModal from './EditProductModal'
import AddUserModal from './AddUserModal'
import EditUserModal from './EditUserModal'
import AddClientModal from './AddClientModal'
import EditClientModal from './EditClientModal'
import AddSupplierModal from './AddSupplierModal'
import AddPurchaseModal from './AddPurchaseModal'
import AddCheckModal from './AddCheckModal'
import CustomConfirmModal from './CustomConfirmModal'

export default function AppModals({
  openShiftModal,
  currentUser,
  startingCash,
  setStartingCash,
  momknStartBalance,
  setMomknStartBalance,
  momknStartCash,
  setMomknStartCash,
  vfcashStartBalance,
  setVfcashStartBalance,
  vfcashStartCash,
  setVfcashStartCash,
  handleStartShift,

  closeShiftModal,
  currentShift,
  actualEndCash,
  setActualEndCash,
  setCloseShiftModal,
  handleConfirmCloseShift,

  customAlert,
  closeCustomAlert,
  customConfirm,
  closeCustomConfirm,

  approvalRequest,
  setApprovalRequest,
  returnRequestOpen,
  setReturnRequestOpen,

  showAddModal,
  setShowAddModal,
  newProduct,
  setNewProduct,
  addProductBarcodeRef,
  handleAddProduct,

  showEditModal,
  setShowEditModal,
  editProduct,
  setEditProduct,
  handleEditProduct,

  showAddUserModal,
  setShowAddUserModal,
  newUser,
  setNewUser,
  handleAddUser,

  showEditUserModal,
  setShowEditUserModal,
  handleResetPassword,
  editUser,
  setEditUser,
  handleEditUser,
  rolesList,

  showAddClientModal,
  setShowAddClientModal,
  newClientForm,
  setNewClientForm,
  handleAddClient,

  showEditClientModal,
  setShowEditClientModal,
  editClientForm,
  setEditClientForm,
  handleEditClient,

  showAddSupplierModal,
  setShowAddSupplierModal,
  newSupplierForm,
  setNewSupplierForm,
  handleAddSupplier,

  showAddPurchaseModal,
  setShowAddPurchaseModal,
  selectedSupplier,
  newPurchaseForm,
  setNewPurchaseForm,
  handleAddPurchase,

  showAddCheckModal,
  setShowAddCheckModal,
  newCheckForm,
  setNewCheckForm,
  handleAddCheck
}) {
  return (
    <>
      <OpenShiftModal
        openShiftModal={openShiftModal}
        currentUser={currentUser}
        startingCash={startingCash}
        setStartingCash={setStartingCash}
        momknStartBalance={momknStartBalance}
        setMomknStartBalance={setMomknStartBalance}
        momknStartCash={momknStartCash}
        setMomknStartCash={setMomknStartCash}
        vfcashStartBalance={vfcashStartBalance}
        setVfcashStartBalance={setVfcashStartBalance}
        vfcashStartCash={vfcashStartCash}
        setVfcashStartCash={setVfcashStartCash}
        handleStartShift={handleStartShift}
      />

      <CloseShiftModal
        closeShiftModal={closeShiftModal}
        currentUser={currentUser}
        currentShift={currentShift}
        actualEndCash={actualEndCash}
        setActualEndCash={setActualEndCash}
        setCloseShiftModal={setCloseShiftModal}
        handleConfirmCloseShift={handleConfirmCloseShift}
      />

      <CustomAlertModal customAlert={customAlert} closeCustomAlert={closeCustomAlert} />

      <CustomConfirmModal customConfirm={customConfirm} closeCustomConfirm={closeCustomConfirm} />

      <SupervisorApprovalModal
        request={approvalRequest}
        onCancel={() => setApprovalRequest(null)}
      />

      <ReturnRequestModal
        open={returnRequestOpen}
        onClose={() => setReturnRequestOpen(false)}
        currentUser={currentUser}
        currentShift={currentShift}
      />

      <AddProductModal
        showAddModal={showAddModal}
        setShowAddModal={setShowAddModal}
        newProduct={newProduct}
        setNewProduct={setNewProduct}
        addProductBarcodeRef={addProductBarcodeRef}
        handleAddProduct={handleAddProduct}
      />

      <EditProductModal
        showEditModal={showEditModal}
        setShowEditModal={setShowEditModal}
        editProduct={editProduct}
        setEditProduct={setEditProduct}
        handleEditProduct={handleEditProduct}
      />

      <AddUserModal
        showAddUserModal={showAddUserModal}
        setShowAddUserModal={setShowAddUserModal}
        newUser={newUser}
        setNewUser={setNewUser}
        handleAddUser={handleAddUser}
        rolesList={rolesList}
      />

      <EditUserModal
        showEditUserModal={showEditUserModal}
        setShowEditUserModal={setShowEditUserModal}
        editUser={editUser}
        setEditUser={setEditUser}
        handleEditUser={handleEditUser}
        handleResetPassword={handleResetPassword}
        rolesList={rolesList}
      />

      <AddClientModal
        showAddClientModal={showAddClientModal}
        setShowAddClientModal={setShowAddClientModal}
        newClientForm={newClientForm}
        setNewClientForm={setNewClientForm}
        handleAddClient={handleAddClient}
      />

      <EditClientModal
        showEditClientModal={showEditClientModal}
        setShowEditClientModal={setShowEditClientModal}
        editClientForm={editClientForm}
        setEditClientForm={setEditClientForm}
        handleEditClient={handleEditClient}
      />

      <AddSupplierModal
        showAddSupplierModal={showAddSupplierModal}
        setShowAddSupplierModal={setShowAddSupplierModal}
        newSupplierForm={newSupplierForm}
        setNewSupplierForm={setNewSupplierForm}
        handleAddSupplier={handleAddSupplier}
      />

      <AddPurchaseModal
        showAddPurchaseModal={showAddPurchaseModal}
        setShowAddPurchaseModal={setShowAddPurchaseModal}
        selectedSupplier={selectedSupplier}
        newPurchaseForm={newPurchaseForm}
        setNewPurchaseForm={setNewPurchaseForm}
        handleAddPurchase={handleAddPurchase}
      />

      <AddCheckModal
        showAddCheckModal={showAddCheckModal}
        setShowAddCheckModal={setShowAddCheckModal}
        newCheckForm={newCheckForm}
        setNewCheckForm={setNewCheckForm}
        handleAddCheck={handleAddCheck}
      />
    </>
  )
}
