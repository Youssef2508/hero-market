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

  // Manager Approval Modal
  const [managerApprovalModal, setManagerApprovalModal] = useState(false)
  const [managerPin, setManagerPin] = useState('')
  const [pendingAction, setPendingAction] = useState(null) // { type: string, payload: any }

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
    managerApprovalModal,
    setManagerApprovalModal,
    managerPin,
    setManagerPin,
    pendingAction,
    setPendingAction,
    handleLock
  }
}
