import { useState } from 'react'

/**
 * Custom hook to manage shifts, locking, and authentication state.
 */
export function useShift() {
  const [currentUser, setCurrentUser] = useState(null)
  const [currentShift, setCurrentShift] = useState(null)
  const [isLocked, setIsLocked] = useState(true)

  // Shift Modals
  const [openShiftModal, setOpenShiftModal] = useState(false)
  const [startingCash, setStartingCash] = useState('0')
  const [momknStartBalance, setMomknStartBalance] = useState('0')
  const [momknStartCash, setMomknStartCash] = useState('0')
  const [vfcashStartBalance, setVfcashStartBalance] = useState('0')
  const [vfcashStartCash, setVfcashStartCash] = useState('0')
  const [closeShiftModal, setCloseShiftModal] = useState(false)
  const [actualEndCash, setActualEndCash] = useState('')

  // Supervisor approval on this till (SupervisorApprovalModal): null or the request to approve.
  const [approvalRequest, setApprovalRequest] = useState(null)
  // Return from the till (ReturnRequestModal).
  const [returnRequestOpen, setReturnRequestOpen] = useState(false)

  const handleLock = () => {
    setIsLocked(true)
    setCurrentUser(null)
    setCurrentShift(null)
  }

  return {
    currentUser,
    setCurrentUser,
    currentShift,
    setCurrentShift,
    isLocked,
    setIsLocked,
    openShiftModal,
    setOpenShiftModal,
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
    closeShiftModal,
    setCloseShiftModal,
    actualEndCash,
    setActualEndCash,
    approvalRequest,
    setApprovalRequest,
    returnRequestOpen,
    setReturnRequestOpen,
    handleLock
  }
}
