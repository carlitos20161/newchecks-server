import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
  Paper,
  Divider,
  Snackbar,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  ListItemText,
  Tabs,
  Tab,
  Avatar,
  Fab,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  Tooltip,
  Fade,
} from "@mui/material";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  runTransaction,
  doc,
  query,
  where,
  getDoc,
  setDoc,
  updateDoc,
  orderBy,
} from "firebase/firestore";

interface Company {
  id: string;
  name: string;
  logoBase64?: string;
}

interface Employee {
  id: string;
  name: string;
  payRate: number;
  payType: string;
  payTypes?: string[];
  companyId?: string | null;
  companyIds?: string[];
  clientId?: string | null;
  clientPayTypeRelationships?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    payType: 'hourly' | 'perdiem';
    payRate?: string;
    active: boolean;
  }>;
  active: boolean;  
}

interface Client {
  id: string;
  name: string;
  companyIds?: string[];
  active: boolean;  
}

interface PayInput {
  hours: string;
  otHours: string;
  holidayHours: string;
  memo: string;
  paymentMethods?: string[]; // Array of 'hourly' and/or 'perdiem'
  selectedRelationshipId?: string; // Selected client-pay type relationship ID (legacy - keeping for backward compatibility)
  selectedRelationshipIds?: string[]; // NEW: Array of selected relationship IDs for multiple relationships
  perdiemAmount?: string; // Separate field for per diem amount
  perdiemBreakdown?: boolean; // Whether to use breakdown or full amount
  perdiemMonday?: string;
  perdiemTuesday?: string;
  perdiemWednesday?: string;
  perdiemThursday?: string;
  perdiemFriday?: string;
  perdiemSaturday?: string;
  perdiemSunday?: string;
  [key: string]: any; // Allow dynamic relationship-based fields like "relationshipId_hours", "relationshipId_perdiemAmount", etc.
}

// Helper to chunk an array into groups of size n
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

interface BatchChecksProps {
  onChecksCreated?: () => void;
  onGoToSection: (section: string) => void;
}

// Floating menu state interface
interface FloatingMenuState {
  open: boolean;
  companyId: string | null;
  clientId: string | null;
  checkId: string | null;
  companyName: string;
  clientName: string;
}

  const BatchChecks: React.FC<BatchChecksProps> = ({ onChecksCreated, onGoToSection }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null
  );
  const [selectedClientId, setSelectedClientId] = useState<string>('multiple');

  // Store data per client tab to prevent loss when switching tabs
  const [tabData, setTabData] = useState<{
    [tabId: string]: {
      selectedEmployees: { [id: string]: boolean };
      inputs: { [id: string]: PayInput };
    };
  }>({});

  // Current tab's data
  const currentTabId = selectedClientId || 'multiple';
  const selectedEmployees = tabData[currentTabId]?.selectedEmployees || {};
  const inputs = tabData[currentTabId]?.inputs || {};

  // Helper functions to update tab data
  const setSelectedEmployees = (newSelectedEmployees: { [id: string]: boolean } | ((prev: { [id: string]: boolean }) => { [id: string]: boolean })) => {
    const tabId = selectedClientId || 'multiple'; // Capture current tab at function call time
    setTabData(prev => {
      const currentData = prev[tabId] || { selectedEmployees: {}, inputs: {} };
      const updatedEmployees = typeof newSelectedEmployees === 'function' 
        ? newSelectedEmployees(currentData.selectedEmployees)
        : newSelectedEmployees;
      
      return {
        ...prev,
        [tabId]: {
          ...currentData,
          selectedEmployees: updatedEmployees
        }
      };
    });
  };

  const setInputs = (newInputs: { [id: string]: PayInput } | ((prev: { [id: string]: PayInput }) => { [id: string]: PayInput })) => {
    const tabId = selectedClientId || 'multiple'; // Capture current tab at function call time
    setTabData(prev => {
      const currentData = prev[tabId] || { selectedEmployees: {}, inputs: {} };
      const updatedInputs = typeof newInputs === 'function'
        ? newInputs(currentData.inputs)
        : newInputs;
      
      return {
        ...prev,
        [tabId]: {
          ...currentData,
          inputs: updatedInputs
        }
      };
    });
  };
  const [isCreatingChecks, setIsCreatingChecks] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageText, setSuccessMessageText] = useState('');
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewData, setReviewData] = useState<Array<{
    employee: Employee;
    input: PayInput;
    calculatedAmount: number;
    hourlyTotal: number;
    perDiemTotal: number;
  }>>([]);
  const [clientSearchTerm, setClientSearchTerm] = useState<string>("");
  const [clientStatusFilter, setClientStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  
  // Floating menu state
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenuState>({
    open: false,
    companyId: null,
    clientId: null,
    checkId: null,
    companyName: '',
    clientName: ''
  });

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;

      // Fetch the user document
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      const role = userData.role || 'user';
      const companyIds: string[] = userData.companyIds || [];

      let filteredCompanies: Company[] = [];
      if (role === 'admin') {
        // Admin: fetch ALL companies
        const compSnap = await getDocs(collection(db, "companies"));
        filteredCompanies = compSnap.docs.map((doc) => ({
          id: doc.id,
          name: doc.data()?.name || "Unnamed",
          logoBase64: doc.data()?.logoBase64 || null,
        }));
        console.log("[BatchChecks] (admin) fetched companies:", filteredCompanies);
      } else {
        // Non-admin: fetch only assigned companies using where('__name__', 'in', companyIds) in chunks of 10
        console.log("[BatchChecks] user companyIds:", companyIds);
        let companyDocs: any[] = [];
        if (companyIds.length > 0) {
          const chunks = chunkArray(companyIds, 10);
          for (const chunk of chunks) {
            const q = query(collection(db, "companies"), where("__name__", "in", chunk));
            const snap = await getDocs(q);
            companyDocs.push(...snap.docs);
          }
        }
        filteredCompanies = companyDocs.map((doc) => ({
              id: doc.id,
          name: doc.data()?.name || "Unnamed",
          logoBase64: doc.data()?.logoBase64 || null,
        }));
        console.log("[BatchChecks] (user) fetched companies:", filteredCompanies);
      }
      setCompanies(filteredCompanies);

      // Fetch employees
      let empDocs = [];
      if (role === 'admin') {
      const empSnap = await getDocs(collection(db, "employees"));
        empDocs = empSnap.docs;
        console.log("[BatchChecks] (admin) fetched employees:", empDocs.map(d => ({ id: d.id, ...d.data() })));
      } else {
        const queries = companyIds.map((id) =>
          getDocs(query(collection(db, "employees"), where("companyId", "==", id)))
        );
        const results = await Promise.allSettled(queries);
        empDocs = results
          .filter((r) => r.status === "fulfilled")
          .flatMap((r) => (r as PromiseFulfilledResult<any>).value.docs);
        results
          .filter((r) => r.status === "rejected")
          .forEach((r) => console.warn("🔥 Failed employee query:", r.reason));
        console.log("[BatchChecks] (user) fetched employees:", empDocs.map(d => ({ id: d.id, ...d.data() })));
      }
      setEmployees(empDocs.map((d) => ({ id: d.id, ...d.data() } as Employee)));

      // Fetch clients
      const clientSnap = await getDocs(collection(db, "clients"));
      const clientList: Client[] = clientSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        companyIds: d.data().companyId || [], // Note: field is 'companyId' in Firestore but contains array
        active: d.data().active ?? true,
      }));
      setClients(clientList);
      console.log("[BatchChecks] fetched clients:", clientList);
    };
  
    fetchData();
  }, []);
  
  // Get clients for the selected company
  const companyClients = selectedCompanyId 
    ? clients.filter(client => 
        client.active && 
        client.companyIds && 
        client.companyIds.includes(selectedCompanyId)
      )
    : [];

  // Filter clients based on search and status
  const filteredCompanyClients = companyClients.filter(client => {
    const matchesSearch = clientSearchTerm === "" || 
      client.name.toLowerCase().includes(clientSearchTerm.toLowerCase());
    const matchesStatus = clientStatusFilter === 'all' || 
      (clientStatusFilter === 'active' && client.active) ||
      (clientStatusFilter === 'inactive' && !client.active);
    
    return matchesSearch && matchesStatus;
  });

  // Clear all tab data when company changes
  useEffect(() => {
    setTabData({});
    setSelectedClientId('multiple');  // Keep it as 'multiple' so filtering works immediately
  }, [selectedCompanyId]);

  // Don't clear selections when switching client tabs - let users keep their work

  const filteredEmployees = selectedCompanyId
  ? employees.filter((e) => {
      if (!e.active) {
        console.log(`🚫 [Filter] ${e.name} excluded - inactive`);
        return false; // Exclude inactive employees
      }
      
      // Company filter
      const matchArray =
        Array.isArray((e as any).companyIds) &&
        (e as any).companyIds.includes(selectedCompanyId);
      const matchSingle = e.companyId === selectedCompanyId;
      const matchCompany = matchArray || matchSingle;
      
      if (!matchCompany) {
        console.log(`🚫 [Filter] ${e.name} excluded - company mismatch`);
        return false;
      }
      
      // Client filter (if a specific client is selected)
      if (selectedClientId && selectedClientId !== 'multiple') {
        const matchClient = e.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId) ||
                           e.clientId === selectedClientId;
        if (!matchClient) {
          console.log(`🚫 [Filter] ${e.name} excluded - client mismatch for ${selectedClientId}`);
        }
        return matchClient;
      } else if (selectedClientId === 'multiple') {
        // Multiple clients tab: include employees with client relationships (1 or more)
        const hasRelationships = e.clientPayTypeRelationships && e.clientPayTypeRelationships.length >= 1;
        if (!hasRelationships) {
          console.log(`🚫 [Filter] ${e.name} excluded - only has ${e.clientPayTypeRelationships?.length || 0} client relationships (need ≥1 for multiple clients tab)`);
        }
        return hasRelationships;
      }
      
      return true;
    })
  : [];

  // Helper function to get appropriate payment methods based on selected client tab
  const getDefaultPaymentMethods = (emp: Employee) => {
    console.log(`🔍 [getDefaultPaymentMethods] ${emp.name}:`);
    console.log(`  - selectedClientId: ${selectedClientId}`);
    console.log(`  - emp.payType: ${emp.payType}`);
    console.log(`  - emp.payTypes:`, emp.payTypes);
    
    if (selectedClientId === 'multiple') {
      // Multiple clients tab: allow both payment methods
      const result = emp.payTypes && emp.payTypes.length > 1 ? emp.payTypes : [emp.payType];
      console.log(`  - Multiple clients tab, returning:`, result);
      return result;
    } else if (selectedClientId) {
      // Single client tab: STRICTLY use only the client's pay type
      const selectedClient = companyClients.find(c => c.id === selectedClientId);
      console.log(`  - Selected client:`, selectedClient?.name);
      
      if (selectedClient) {
        // Check if employee has a relationship with this client
        const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === selectedClientId);
        console.log(`  - Found relationship:`, relationship);
        
        if (relationship) {
          // Use the relationship's pay type
          console.log(`  - Using relationship pay type: [${relationship.payType}]`);
          return [relationship.payType];
        }
        
        // If no relationship found, determine pay type from client name
        // This is a fallback for legacy employees without relationships
        if (selectedClient.name.toLowerCase().includes('per diem') || selectedClient.name.toLowerCase().includes('perdiem')) {
          console.log(`  - Client name indicates per diem, returning: ['perdiem']`);
          return ['perdiem'];
        } else if (selectedClient.name.toLowerCase().includes('hourly')) {
          console.log(`  - Client name indicates hourly, returning: ['hourly']`);
          return ['hourly'];
        }
        
        // If we can't determine from client name, use employee's default
        console.log(`  - Using employee default pay type: [${emp.payType}]`);
        return [emp.payType];
      }
    }
    // Default fallback
    console.log(`  - Default fallback, returning: [${emp.payType}]`);
    return [emp.payType];
  };

  // Helper function to get default relationship IDs based on selected client tab
  const getDefaultRelationshipIds = (emp: Employee) => {
    if (selectedClientId === 'multiple') {
      // Multiple clients tab: automatically select all active relationships
      return emp.clientPayTypeRelationships?.filter(rel => rel.active).map(rel => rel.id) || [];
    } else if (selectedClientId) {
      // Single client tab: automatically select the relationship for this client
      const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === selectedClientId);
      if (relationship) {
        return [relationship.id];
      }
    }
    // Default fallback
    return [];
  };

  // Function to fetch and populate previous batch data
  const usePreviousBatch = async () => {
    if (!selectedClientId || !selectedCompanyId) {
      alert("Please select a client first.");
      return;
    }

    try {
      console.log("🔍 Fetching previous batch for client:", selectedClientId);
      
      // Get all checks for this company
      const checksQuery = query(
        collection(db, 'checks'),
        where('companyId', '==', selectedCompanyId),
        orderBy('date', 'desc')
      );
      
      const checksSnapshot = await getDocs(checksQuery);
      const allChecks = checksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      console.log("🔍 Found total checks:", allChecks.length);
      
      // Get ALL employees that could potentially work for this client (not just filtered ones)
      let visibleEmployees: any[] = [];
      
      if (selectedClientId && selectedClientId !== 'multiple') {
        // Single client tab: get ALL employees who can work for this specific client
        const client = companyClients.find(c => c.id === selectedClientId);
        if (client) {
          visibleEmployees = employees.filter(emp => {
            // Must be active and in the right company
            if (!emp.active) return false;
            const matchArray = Array.isArray((emp as any).companyIds) && (emp as any).companyIds.includes(selectedCompanyId);
            const matchSingle = emp.companyId === selectedCompanyId;
            const matchCompany = matchArray || matchSingle;
            if (!matchCompany) return false;
            
            // Check if employee can work for this client
            if (client.name.toLowerCase().includes('per diem')) {
              const hasPerDiemForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                rel.clientId === selectedClientId && rel.payType === 'perdiem'
              );
              const hasLegacyPerDiem = emp.clientId === selectedClientId && emp.payType === 'perdiem';
              return hasPerDiemForThisClient || hasLegacyPerDiem;
            } else if (client.name.toLowerCase().includes('hourly')) {
              const hasHourlyForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                rel.clientId === selectedClientId && rel.payType === 'hourly'
              );
              const hasLegacyHourly = emp.clientId === selectedClientId && emp.payType === 'hourly';
              return hasHourlyForThisClient || hasLegacyHourly;
        } else {
              const hasRelationshipForThisClient = emp.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId);
              const hasLegacyClient = emp.clientId === selectedClientId;
              return hasRelationshipForThisClient || hasLegacyClient;
            }
          });
        }
      } else if (selectedClientId === 'multiple') {
        // Multiple clients tab: get employees with multiple relationships
        visibleEmployees = employees.filter(emp => {
          if (!emp.active) return false;
          const matchArray = Array.isArray((emp as any).companyIds) && (emp as any).companyIds.includes(selectedCompanyId);
          const matchSingle = emp.companyId === selectedCompanyId;
          const matchCompany = matchArray || matchSingle;
          if (!matchCompany) return false;
          
          return emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
        });
      }
      
      console.log("🔍 Using ALL employees for previous batch:", visibleEmployees.length);
      console.log("🔍 Employee names for previous batch:", visibleEmployees.map(emp => emp.name));
      
      const newSelectedEmployees = { ...selectedEmployees };
      const newInputs = { ...inputs };
      let foundPreviousData = false;
      
      // For each visible employee, find their most recent check for this client
      visibleEmployees.forEach((emp: any) => {
        let latestCheck = null;
        
        if (selectedClientId === 'multiple') {
          // For multiple clients, find the most recent check with multiple relationships
          // First filter the checks
          const filteredChecks = allChecks.filter((check: any) => 
            check.employeeId === emp.id && 
            check.clientId === 'multiple' &&
            check.relationshipDetails && 
            check.relationshipDetails.length > 1
          );
          
          // Then sort them properly handling Firestore Timestamps
          const sortedFilteredChecks = filteredChecks
            .map(c => {
              let dateTime: number;
              if (c.date && typeof c.date === 'object' && c.date.toDate) {
                // Firestore Timestamp
                dateTime = c.date.toDate().getTime();
              } else if (c.date) {
                // Regular date string
                dateTime = new Date(c.date).getTime();
              } else {
                dateTime = 0; // fallback for missing dates
              }
              return { ...c, dateTime };
            })
            .sort((a, b) => b.dateTime - a.dateTime);
            
          latestCheck = sortedFilteredChecks[0] || null;
        } else {
          // For single client, find the most recent check for this specific client
          // First filter the checks
          const filteredChecks = allChecks.filter((check: any) => 
            check.employeeId === emp.id && 
            (check.clientId === selectedClientId || 
             (check.relationshipDetails && check.relationshipDetails.some((rel: any) => rel.clientId === selectedClientId)))
          );
          
          // Then sort them properly handling Firestore Timestamps
          const sortedFilteredChecks = filteredChecks
            .map(c => {
              let dateTime: number;
              if (c.date && typeof c.date === 'object' && c.date.toDate) {
                // Firestore Timestamp
                dateTime = c.date.toDate().getTime();
              } else if (c.date) {
                // Regular date string
                dateTime = new Date(c.date).getTime();
              } else {
                dateTime = 0; // fallback for missing dates
              }
              return { ...c, dateTime };
            })
            .sort((a, b) => b.dateTime - a.dateTime);
            
          latestCheck = sortedFilteredChecks[0] || null;
        }
        
        // 🔍 DEBUG: Show all checks for this employee to see sorting
        const employeeChecks = allChecks.filter((check: any) => 
          check.employeeId === emp.id && 
          (check.clientId === selectedClientId || 
           (check.relationshipDetails && check.relationshipDetails.some((rel: any) => rel.clientId === selectedClientId)))
        );
        const sortedChecks = employeeChecks
          .map(c => {
            // Handle both Firestore Timestamps and regular date strings
            let dateTime: number;
            if (c.date && typeof c.date === 'object' && c.date.toDate) {
              // Firestore Timestamp
              dateTime = c.date.toDate().getTime();
            } else if (c.date) {
              // Regular date string
              dateTime = new Date(c.date).getTime();
            } else {
              dateTime = 0; // fallback for missing dates
            }
            
            return { 
              id: c.id, 
              checkNumber: c.checkNumber, 
              date: c.date, 
              dateType: typeof c.date,
              dateObj: c.date && typeof c.date === 'object' && c.date.toDate ? c.date.toDate() : new Date(c.date),
              dateTime: dateTime,
              hours: c.hours, 
              amount: c.amount 
            };
          })
          .sort((a, b) => b.dateTime - a.dateTime);
          
        console.log(`🔍 [DEBUG] All ${employeeChecks.length} checks for ${emp.name} (sorted by date):`, sortedChecks);
        console.log(`🔍 [DEBUG] Top 3 most recent checks:`, sortedChecks.slice(0, 3));
        console.log(`🔍 [DEBUG] DETAILED top 3 checks with dates:`, 
          sortedChecks.slice(0, 3).map(c => ({
            id: c.id,
            checkNumber: c.checkNumber,
            date: c.date,
            dateTime: c.dateTime,
            amount: c.amount,
            hours: c.hours,
            isValidDate: !isNaN(c.dateTime),
            sortKey: new Date(c.date).getTime(),
            // Show readable date for debugging
            readableDate: c.dateObj ? c.dateObj.toISOString() : 'Invalid Date'
          }))
        );
        
        // 🔍 CRITICAL: Show the actual first check being used
        const actualLatestCheck = sortedChecks[0];
        if (actualLatestCheck) {
          console.log(`🔍 [DEBUG] The ACTUAL latest check being used is:`, {
            id: actualLatestCheck.id,
            checkNumber: actualLatestCheck.checkNumber,
            dateTime: actualLatestCheck.dateTime,
            readableDate: actualLatestCheck.dateObj ? actualLatestCheck.dateObj.toISOString() : 'Invalid Date',
            amount: actualLatestCheck.amount,
            hours: actualLatestCheck.hours
          });
        }
        
        // 🔍 CRITICAL DEBUG: Check if our new check is in the list
        const newCheck = sortedChecks.find(c => c.checkNumber === 105266 || c.checkNumber === 105265);
        if (newCheck) {
          console.log(`🔍 [DEBUG] Found our new check in the list:`, {
            id: newCheck.id,
            checkNumber: newCheck.checkNumber,
            date: newCheck.date,
            dateTime: newCheck.dateTime,
            position: sortedChecks.findIndex(c => c.id === newCheck.id),
            amount: newCheck.amount
          });
        } else {
          console.log(`❌ [DEBUG] Our new check (105266 or 105265) is NOT in the sorted list!`);
        }
        
        if (latestCheck) {
          console.log(`🔍 Found previous check for ${emp.name}:`, latestCheck);
          foundPreviousData = true;
          
          // Select the employee
          newSelectedEmployees[emp.id] = true;
          
          // Get default settings
          const defaultPaymentMethods = getDefaultPaymentMethods(emp);
          const defaultRelationshipIds = getDefaultRelationshipIds(emp);
          
          // Populate with previous check data
          const empInput: any = {
            paymentMethods: latestCheck.paymentMethods || defaultPaymentMethods,
            selectedRelationshipIds: latestCheck.selectedRelationshipIds || defaultRelationshipIds,
            hours: latestCheck.hours?.toString() || "",
            otHours: latestCheck.otHours?.toString() || "",
            holidayHours: latestCheck.holidayHours?.toString() || "",
            memo: latestCheck.memo || "",
            perdiemAmount: latestCheck.perdiemAmount?.toString() || "",
            perdiemBreakdown: latestCheck.perdiemBreakdown || false,
            perdiemMonday: latestCheck.perdiemMonday?.toString() || "",
            perdiemTuesday: latestCheck.perdiemTuesday?.toString() || "",
            perdiemWednesday: latestCheck.perdiemWednesday?.toString() || "",
            perdiemThursday: latestCheck.perdiemThursday?.toString() || "",
            perdiemFriday: latestCheck.perdiemFriday?.toString() || "",
            perdiemSaturday: latestCheck.perdiemSaturday?.toString() || "",
            perdiemSunday: latestCheck.perdiemSunday?.toString() || "",
          };
          
          // If employee has relationships, also populate relationship-specific fields
          if (emp.clientPayTypeRelationships) {
            emp.clientPayTypeRelationships.forEach((relationship: any) => {
              if (selectedClientId === 'multiple' || relationship.clientId === selectedClientId) {
                const relId = relationship.id;
                
                // For hourly relationships, copy basic values to relationship-specific fields
                if (relationship.payType === 'hourly') {
                  // Check if there are relationship-specific hours in the saved check
                  const relHours = latestCheck.relationshipHours?.[relId];
                  empInput[`${relId}_hours`] = relHours ? relHours.toString() : empInput.hours;
                  empInput[`${relId}_otHours`] = empInput.otHours;
                  empInput[`${relId}_holidayHours`] = empInput.holidayHours;
                } else if (relationship.payType === 'perdiem') {
                  // For per diem relationships, look for relationship-specific data in the saved check
                  // The check data is stored with keys like: `${relId}_perdiemAmount`, `${relId}_perdiemBreakdown`, etc.
                  
                  // 🔍 ENHANCED DEBUG: Show what per diem data is fetched from database
          const fetchedPerdiemData = {
            employeeName: emp.name,
            relationshipId: relId,
            checkId: (latestCheck as any).id,
            checkPerdiemAmount: latestCheck.perdiemAmount,
            checkPerdiemBreakdown: latestCheck.perdiemBreakdown,
            relationshipSpecificAmount: (latestCheck as any)[`${relId}_perdiemAmount`],
            relationshipSpecificBreakdown: (latestCheck as any)[`${relId}_perdiemBreakdown`],
            checkDailyAmounts: {
              monday: latestCheck.perdiemMonday,
              tuesday: latestCheck.perdiemTuesday,
              wednesday: latestCheck.perdiemWednesday,
              thursday: latestCheck.perdiemThursday,
              friday: latestCheck.perdiemFriday,
              saturday: latestCheck.perdiemSaturday,
              sunday: latestCheck.perdiemSunday
            },
            relationshipSpecificDaily: {
              monday: (latestCheck as any)[`${relId}_perdiemMonday`],
              tuesday: (latestCheck as any)[`${relId}_perdiemTuesday`],
              wednesday: (latestCheck as any)[`${relId}_perdiemWednesday`],
              thursday: (latestCheck as any)[`${relId}_perdiemThursday`],
              friday: (latestCheck as any)[`${relId}_perdiemFriday`],
              saturday: (latestCheck as any)[`${relId}_perdiemSaturday`],
              sunday: (latestCheck as any)[`${relId}_perdiemSunday`]
            },
            allPerdiemFieldsInCheck: Object.keys(latestCheck).filter(key => key.includes('perdiem')).reduce((acc: any, key) => {
              acc[key] = (latestCheck as any)[key];
              return acc;
            }, {}),
            relationshipDetails: latestCheck.relationshipDetails,
            payType: latestCheck.payType
          };
          console.log("📥 [FETCH] Per diem data fetched from database:", fetchedPerdiemData);
                  
                  // Try to restore from relationship-specific fields first, then fallback to generic fields
                  empInput[`${relId}_perdiemAmount`] = (latestCheck as any)[`${relId}_perdiemAmount`] || latestCheck.perdiemAmount?.toString() || "";
                  empInput[`${relId}_perdiemBreakdown`] = (latestCheck as any)[`${relId}_perdiemBreakdown`] !== undefined ? (latestCheck as any)[`${relId}_perdiemBreakdown`] : latestCheck.perdiemBreakdown || false;
                  empInput[`${relId}_perdiemMonday`] = (latestCheck as any)[`${relId}_perdiemMonday`] || latestCheck.perdiemMonday?.toString() || "";
                  empInput[`${relId}_perdiemTuesday`] = (latestCheck as any)[`${relId}_perdiemTuesday`] || latestCheck.perdiemTuesday?.toString() || "";
                  empInput[`${relId}_perdiemWednesday`] = (latestCheck as any)[`${relId}_perdiemWednesday`] || latestCheck.perdiemWednesday?.toString() || "";
                  empInput[`${relId}_perdiemThursday`] = (latestCheck as any)[`${relId}_perdiemThursday`] || latestCheck.perdiemThursday?.toString() || "";
                  empInput[`${relId}_perdiemFriday`] = (latestCheck as any)[`${relId}_perdiemFriday`] || latestCheck.perdiemFriday?.toString() || "";
                  empInput[`${relId}_perdiemSaturday`] = (latestCheck as any)[`${relId}_perdiemSaturday`] || latestCheck.perdiemSaturday?.toString() || "";
                  empInput[`${relId}_perdiemSunday`] = (latestCheck as any)[`${relId}_perdiemSunday`] || latestCheck.perdiemSunday?.toString() || "";
                  
                  // 🔍 DEBUG: Show what per diem data gets populated in input fields
                  const restoredPerdiemData = {
                    employeeName: emp.name,
                    relationshipId: relId,
                    restoredFields: {
                      [`${relId}_perdiemAmount`]: empInput[`${relId}_perdiemAmount`],
                      [`${relId}_perdiemBreakdown`]: empInput[`${relId}_perdiemBreakdown`],
                      [`${relId}_perdiemMonday`]: empInput[`${relId}_perdiemMonday`],
                      [`${relId}_perdiemTuesday`]: empInput[`${relId}_perdiemTuesday`],
                      [`${relId}_perdiemWednesday`]: empInput[`${relId}_perdiemWednesday`],
                      [`${relId}_perdiemThursday`]: empInput[`${relId}_perdiemThursday`],
                      [`${relId}_perdiemFriday`]: empInput[`${relId}_perdiemFriday`],
                      [`${relId}_perdiemSaturday`]: empInput[`${relId}_perdiemSaturday`],
                      [`${relId}_perdiemSunday`]: empInput[`${relId}_perdiemSunday`]
                    }
                  };
                  console.log("🔄 [RESTORE] Per diem data populated in input fields:", restoredPerdiemData);
                }
              }
            });
          }
          
          // Calculate the total amount for this restored data
          const restoredAmount = calculateAmount(emp, empInput);
          console.log(`💰 [USE PREVIOUS BATCH] ${emp.name}: restored amount = $${restoredAmount} from check ID: ${latestCheck.id}`);
          console.log(`💰 [USE PREVIOUS BATCH] ${emp.name}: restored data =`, empInput);
          
          newInputs[emp.id] = empInput;
        } else {
          console.log(`🔍 No previous check found for ${emp.name}`);
        }
      });
      
      if (foundPreviousData) {
        setSelectedEmployees(newSelectedEmployees);
        setInputs(newInputs);
        const loadedCount = Object.keys(newSelectedEmployees).filter(id => newSelectedEmployees[id]).length;
        setSuccessMessageText(`Successfully loaded previous batch data for ${loadedCount} employees!`);
        setShowSuccessMessage(true);
        // Auto-hide after 4 seconds
        setTimeout(() => setShowSuccessMessage(false), 4000);
      } else {
        setSuccessMessageText("No previous batch data found for these employees. Please create checks manually.");
        setShowSuccessMessage(true);
        // Auto-hide after 4 seconds
        setTimeout(() => setShowSuccessMessage(false), 4000);
      }
      
    } catch (error) {
      console.error("Error fetching previous batch:", error);
      setSuccessMessageText("Error fetching previous batch data. Please try again.");
      setShowSuccessMessage(true);
      // Auto-hide after 4 seconds
      setTimeout(() => setShowSuccessMessage(false), 4000);
    }
  };

  const toggleEmployee = (id: string) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    // Check if employee is currently selected before toggling
  const isCurrentlySelected = selectedEmployees[id];
  setSelectedEmployees((prev) => ({ ...prev, [id]: !prev[id] }));

  // If unchecking an employee, clear their input data to prevent validation conflicts
  if (isCurrentlySelected) {
    setInputs((prev) => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
    return; // Exit early when unchecking
}
    
    // Auto-set payment methods and relationships based on selected client tab
    const defaultPaymentMethods = getDefaultPaymentMethods(emp);
    const defaultRelationshipIds = getDefaultRelationshipIds(emp);
    
    // Debug logging
    console.log(`🔍 [toggleEmployee] ${emp.name} (${id}):`);
    console.log(`  - selectedClientId: ${selectedClientId}`);
    console.log(`  - defaultPaymentMethods:`, defaultPaymentMethods);
    console.log(`  - defaultRelationshipIds:`, defaultRelationshipIds);
    
    setInputs((prev) => {
      const baseInput = prev[id] || {
        hours: "",
        otHours: "",
        holidayHours: "",
        memo: "",
        paymentMethods: defaultPaymentMethods,
        selectedRelationshipIds: defaultRelationshipIds,
        perdiemAmount: "",
        perdiemBreakdown: false,
        perdiemMonday: "",
        perdiemTuesday: "",
        perdiemWednesday: "",
        perdiemThursday: "",
        perdiemFriday: "",
        perdiemSaturday: "",
        perdiemSunday: "",
      };

      // If single client is selected, initialize relationship-specific fields
      if (selectedClientId !== 'multiple' && emp.clientPayTypeRelationships) {
        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
        if (relationship) {
          // Initialize relationship-specific fields
          baseInput[`${relationship.id}_perdiemBreakdown`] = baseInput[`${relationship.id}_perdiemBreakdown`] || false;
          baseInput[`${relationship.id}_perdiemAmount`] = baseInput[`${relationship.id}_perdiemAmount`] || "";
          baseInput[`${relationship.id}_perdiemMonday`] = baseInput[`${relationship.id}_perdiemMonday`] || "";
          baseInput[`${relationship.id}_perdiemTuesday`] = baseInput[`${relationship.id}_perdiemTuesday`] || "";
          baseInput[`${relationship.id}_perdiemWednesday`] = baseInput[`${relationship.id}_perdiemWednesday`] || "";
          baseInput[`${relationship.id}_perdiemThursday`] = baseInput[`${relationship.id}_perdiemThursday`] || "";
          baseInput[`${relationship.id}_perdiemFriday`] = baseInput[`${relationship.id}_perdiemFriday`] || "";
          baseInput[`${relationship.id}_perdiemSaturday`] = baseInput[`${relationship.id}_perdiemSaturday`] || "";
          baseInput[`${relationship.id}_perdiemSunday`] = baseInput[`${relationship.id}_perdiemSunday`] || "";
          
          // Also initialize hourly fields if needed
          if (relationship.payType === 'hourly') {
            baseInput[`${relationship.id}_hours`] = baseInput[`${relationship.id}_hours`] || "";
            baseInput[`${relationship.id}_otHours`] = baseInput[`${relationship.id}_otHours`] || "";
            baseInput[`${relationship.id}_holidayHours`] = baseInput[`${relationship.id}_holidayHours`] || "";
          }
          
          // Debug logging
          console.log(`🔍 DEBUG initialized relationship fields for ${emp.name}:`, {
            relationshipId: relationship.id,
            perdiemBreakdown: baseInput[`${relationship.id}_perdiemBreakdown`],
            perdiemMonday: baseInput[`${relationship.id}_perdiemMonday`],
            perdiemTuesday: baseInput[`${relationship.id}_perdiemTuesday`],
            perdiemWednesday: baseInput[`${relationship.id}_perdiemWednesday`]
          });
        }
      }

      return {
        ...prev,
        [id]: baseInput,
      };
    });
  };

  const handleInputChange = (id: string, field: string, value: string | string[] | boolean) => {
    // Enhanced debug logging for per diem fields
    if (field.includes('perdiem')) {
      const employee = employees.find(e => e.id === id);
      console.log('✏️ [INPUT] Per diem field updated:', {
        employeeName: employee?.name || 'Unknown',
        employeeId: id,
        field: field,
        value: value,
        valueType: typeof value,
        isRelationshipSpecific: field.includes('_perdiem'),
        currentTab: selectedClientId,
        timestamp: new Date().toISOString()
      });
    }
    
    setInputs((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const calculateHourlyTotal = (emp: Employee, data: PayInput) => {
    const baseRate = getEffectivePayRate(emp, data, 'hourly');
    const hours = parseFloat(data.hours) || 0;
    const otHours = parseFloat(data.otHours) || 0;
    const holidayHours = parseFloat(data.holidayHours) || 0;

    return (hours * baseRate + otHours * baseRate * 1.5 + holidayHours * baseRate * 2).toFixed(2);
  };

  // New function to calculate hourly total for a specific relationship
  const calculateHourlyTotalForRelationship = (emp: Employee, data: PayInput, relationshipId: string) => {
    const baseRate = getRelationshipPayRate(emp, relationshipId);
    const hours = parseFloat((data as any)[`${relationshipId}_hours`]) || 0;
    const otHours = parseFloat((data as any)[`${relationshipId}_otHours`]) || 0;
    const holidayHours = parseFloat((data as any)[`${relationshipId}_holidayHours`]) || 0;

    return (hours * baseRate + otHours * baseRate * 1.5 + holidayHours * baseRate * 2).toFixed(2);
  };

  const calculatePerDiemTotal = (data: PayInput) => {
    if (data.perdiemBreakdown) {
      // Calculate from daily breakdown
      const monday = parseFloat(data.perdiemMonday || '0') || 0;
      const tuesday = parseFloat(data.perdiemTuesday || '0') || 0;
      const wednesday = parseFloat(data.perdiemWednesday || '0') || 0;
      const thursday = parseFloat(data.perdiemThursday || '0') || 0;
      const friday = parseFloat(data.perdiemFriday || '0') || 0;
      const saturday = parseFloat(data.perdiemSaturday || '0') || 0;
      const sunday = parseFloat(data.perdiemSunday || '0') || 0;
      
      return (monday + tuesday + wednesday + thursday + friday + saturday + sunday).toFixed(2);
    } else {
      // Use full amount
      return (parseFloat(data.perdiemAmount || '0') || 0).toFixed(2);
    }
  };

  // New function to calculate per diem total for a specific relationship
  const calculatePerDiemTotalForRelationship = (data: PayInput, relationshipId: string) => {
    const perdiemBreakdown = (data as any)[`${relationshipId}_perdiemBreakdown`];
    
    if (perdiemBreakdown) {
      // Calculate from daily breakdown
      const monday = parseFloat((data as any)[`${relationshipId}_perdiemMonday`] || '0') || 0;
      const tuesday = parseFloat((data as any)[`${relationshipId}_perdiemTuesday`] || '0') || 0;
      const wednesday = parseFloat((data as any)[`${relationshipId}_perdiemWednesday`] || '0') || 0;
      const thursday = parseFloat((data as any)[`${relationshipId}_perdiemThursday`] || '0') || 0;
      const friday = parseFloat((data as any)[`${relationshipId}_perdiemFriday`] || '0') || 0;
      const saturday = parseFloat((data as any)[`${relationshipId}_perdiemSaturday`] || '0') || 0;
      const sunday = parseFloat((data as any)[`${relationshipId}_perdiemSunday`] || '0') || 0;
      
      return (monday + tuesday + wednesday + thursday + friday + saturday + sunday).toFixed(2);
    } else {
      // Use full amount
      return (parseFloat((data as any)[`${relationshipId}_perdiemAmount`] || '0') || 0).toFixed(2);
    }
  };

  // Helper function to get the correct pay rate for an employee based on selected relationships
  const getEffectivePayRate = (emp: Employee, data: PayInput, payType: 'hourly' | 'perdiem') => {
    if (data.selectedRelationshipIds && data.selectedRelationshipIds.length > 0) {
      const relationship = emp.clientPayTypeRelationships?.find(rel => 
        rel.payType === payType && 
        data.selectedRelationshipIds?.includes(rel.id)
      );
      if (relationship?.payRate) {
        return parseFloat(relationship.payRate);
      }
    }
    return emp.payRate || 0;
  };

  // Helper function to get the pay rate for a specific relationship
  const getRelationshipPayRate = (emp: Employee, relationshipId: string) => {
    const relationship = emp.clientPayTypeRelationships?.find(rel => rel.id === relationshipId);
    console.log('🔍 DEBUG getRelationshipPayRate:', {
      employeeName: emp.name,
      relationshipId,
      relationship,
      relationshipPayRate: relationship?.payRate,
      empDefaultPayRate: emp.payRate
    });
    if (relationship?.payRate) {
      return parseFloat(relationship.payRate);
    }
    return emp.payRate || 0;
  };

  const calculateAmount = (emp: Employee, data: PayInput) => {
    let total = 0;
    
    // If we have selected relationships, calculate from those
    if (data.selectedRelationshipIds && data.selectedRelationshipIds.length > 0) {
      // Calculate total from all selected relationships
      data.selectedRelationshipIds.forEach(relationshipId => {
        const relationship = emp.clientPayTypeRelationships?.find(rel => rel.id === relationshipId);
        if (relationship) {
          if (relationship.payType === 'hourly') {
            total += parseFloat(calculateHourlyTotalForRelationship(emp, data, relationshipId));
          } else if (relationship.payType === 'perdiem') {
            total += parseFloat(calculatePerDiemTotalForRelationship(data, relationshipId));
          }
        }
      });
    } else {
      // Handle single client scenarios - check if employee has relationship data
      if (emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 0) {
        // Employee has relationships - find the one for the selected client
        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
        if (relationship) {
          if (relationship.payType === 'perdiem') {
            // For per diem relationships, look for relationship-specific data
            const relationshipId = relationship.id;
            const perdiemAmount = parseFloat(data[`${relationshipId}_perdiemAmount`] || '0');
            const perdiemBreakdown = data[`${relationshipId}_perdiemBreakdown`];
            
            if (perdiemBreakdown) {
              // Calculate from daily breakdown
              const dailyTotal = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                 'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                .reduce((sum, day) => sum + parseFloat(data[`${relationshipId}_${day}`] || '0'), 0);
              total += dailyTotal;
            } else if (perdiemAmount > 0) {
              total += perdiemAmount;
            }
          } else if (relationship.payType === 'hourly') {
            // For hourly relationships, look for relationship-specific data
            const relationshipId = relationship.id;
            const baseRate = relationship.payRate ? parseFloat(relationship.payRate) : (emp.payRate || 0);
            const hours = parseFloat(data[`${relationshipId}_hours`] || '0');
            const otHours = parseFloat(data[`${relationshipId}_otHours`] || '0');
            const holidayHours = parseFloat(data[`${relationshipId}_holidayHours`] || '0');

            total += hours * baseRate + otHours * baseRate * 1.5 + holidayHours * baseRate * 2;
          }
        }
      } else {
        // Fallback to old calculation method for legacy employees
        const paymentMethods = data.paymentMethods || [emp.payType];
      
        if (paymentMethods.includes('perdiem')) {
          const perdiemTotal = parseFloat(calculatePerDiemTotal(data));
          total += perdiemTotal;
        }
        
        if (paymentMethods.includes('hourly')) {
          const baseRate = getEffectivePayRate(emp, data, 'hourly');
          const hours = parseFloat(data.hours) || 0;
          const otHours = parseFloat(data.otHours) || 0;
          const holidayHours = parseFloat(data.holidayHours) || 0;

          total += hours * baseRate + otHours * baseRate * 1.5 + holidayHours * baseRate * 2;
        }
      }
    }

    return total.toFixed(2);
  };

  // Helper function to get ISO week number
  const getISOWeek = (date: Date): number => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    // January 4 is always in week 1
    const week1 = new Date(d.getFullYear(), 0, 4);
    // Adjust to Thursday in week 1 and count weeks
    const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return week;
  };

  const handleCreateChecks = async () => {
    if (!selectedCompanyId) {
      alert("Please select a company first.");
      return;
    }

    // Use the same logic as reviewChecks to collect from ALL tabs
    console.log(`🚀🚀🚀 [CreateChecks] Using ALL tabs logic - collecting from ALL tabs 🚀🚀🚀`);
    
    // Get all selected employees from all tabs
    const allSelectedEmployees = new Set<string>();
    Object.keys(tabData).forEach(clientId => {
      const tabSelectedEmployees = tabData[clientId]?.selectedEmployees || {};
      Object.keys(tabSelectedEmployees).forEach(empId => {
        if (tabSelectedEmployees[empId]) {
          allSelectedEmployees.add(empId);
        }
      });
    });

    // Get all employees with input data from all tabs
    const employeesWithInputData = new Set<string>();
    Object.keys(tabData).forEach(clientId => {
      const tabInputs = tabData[clientId]?.inputs || {};
      Object.keys(tabInputs).forEach(empId => {
                 const data = tabInputs[empId];
         if (data && (
           (data.hours && parseFloat(data.hours as string) > 0) || 
           (data.otHours && parseFloat(data.otHours as string) > 0) || 
           (data.holidayHours && parseFloat(data.holidayHours as string) > 0) || 
           (data.perdiemAmount && parseFloat(data.perdiemAmount as string) > 0) ||
           (data.perdiemBreakdown && Object.values(data).some((val: any) => 
             typeof val === 'number' && val > 0
           ))
         )) {
           employeesWithInputData.add(empId);
         }
      });
    });

    // Combine both sets
    const allSelectedArray = Array.from(allSelectedEmployees);
    const employeesWithInputArray = Array.from(employeesWithInputData);
    const selectedEmployeeIds = Array.from(new Set([...allSelectedArray, ...employeesWithInputArray]));
    console.log(`🔍 [CreateChecks] All selected employees:`, allSelectedArray);
    console.log(`🔍 [CreateChecks] Employees with input data:`, employeesWithInputArray);
    console.log(`🔍 [CreateChecks] Final combined for creation:`, selectedEmployeeIds);
    console.log(`🔍 [CreateChecks] Total count for creation:`, selectedEmployeeIds.length);
    
    if (selectedEmployeeIds.length === 0) {
      alert("Please select at least one employee.");
      return;
    }

    // Validate all selected employees
    console.log(`🔍 [CreateChecks] Processing ${selectedEmployeeIds.length} employees:`, selectedEmployeeIds);
    for (const empId of selectedEmployeeIds) {
      const emp = employees.find((e) => e.id === empId);
      if (!emp) {
        console.log(`🚫 [CreateChecks] Employee ${empId} not found in employees list`);
        continue;
      }

      // Find the data from the correct tab
      let data = null;
      let sourceTab = '';
      for (const clientId of Object.keys(tabData)) {
        const tabInputs = tabData[clientId]?.inputs || {};
        if (tabInputs[empId]) {
          data = tabInputs[empId];
          sourceTab = clientId;
          break;
        }
      }
      
      if (!data) {
        console.log(`🚫 [CreateChecks] No input data for ${emp.name}`);
        alert(`Please fill in data for ${emp.name}`);
        return;
      }
      console.log(`✅ [CreateChecks] Processing ${emp.name} with data from tab ${sourceTab}:`, data);

      // Additional debug for per diem data
      if (emp.name === 'CARLOS A') {
                  console.log('🔍 [DEBUG] CARLOS A per diem debug:', {
            employeeName: emp.name,
            sourceTab: sourceTab,
            allDataKeys: Object.keys(data),
            perdiemKeys: Object.keys(data).filter(key => key.includes('perdiem')),
            relationshipIds: emp.clientPayTypeRelationships?.map(rel => rel.id) || [],
            perdiemRelationships: emp.clientPayTypeRelationships?.filter(rel => rel.payType === 'perdiem') || [],
            // Check all possible per diem relationship fields
            perdiemData: {
              '1754920047204_perdiemAmount': data['1754920047204_perdiemAmount'],
              '1754920047204_perdiemBreakdown': data['1754920047204_perdiemBreakdown'],
              '1754920047204_perdiemMonday': data['1754920047204_perdiemMonday'],
              '1754920047204_perdiemTuesday': data['1754920047204_perdiemTuesday'],
              '1754920048644_perdiemAmount': data['1754920048644_perdiemAmount'],
              '1754920048644_perdiemBreakdown': data['1754920048644_perdiemBreakdown'],
              '1754920048644_perdiemMonday': data['1754920048644_perdiemMonday'],
              '1754920048644_perdiemTuesday': data['1754920048644_perdiemTuesday'],
            },
            basicPerdiemData: {
              perdiemAmount: data.perdiemAmount,
              perdiemBreakdown: data.perdiemBreakdown,
              perdiemMonday: data.perdiemMonday,
              perdiemTuesday: data.perdiemTuesday
            }
          });
      }

      // Validation based on ACTUAL DATA entered, not the currently selected tab
      // Determine what type of payment this employee actually has
      
      // Check for relationship-based data (Multiple Clients tab)
      let hasHourlyData = false;
      let hasPerDiemData = false;
      
      if (selectedClientId === 'multiple' && data.selectedRelationshipIds && data.selectedRelationshipIds.length > 0) {
        // For multiple clients, check relationship-specific fields
        const relationships = emp.clientPayTypeRelationships?.filter(rel => 
          data.selectedRelationshipIds!.includes(rel.id)
        ) || [];
        
        for (const rel of relationships) {
          if (rel.payType === 'hourly') {
            const relHours = parseFloat(data[`${rel.id}_hours`] || '0');
            const relOtHours = parseFloat(data[`${rel.id}_otHours`] || '0');
            const relHolidayHours = parseFloat(data[`${rel.id}_holidayHours`] || '0');
            if (relHours > 0 || relOtHours > 0 || relHolidayHours > 0) {
              hasHourlyData = true;
            }
          } else if (rel.payType === 'perdiem') {
            const relAmount = parseFloat(data[`${rel.id}_perdiemAmount`] || '0');
            const relBreakdown = data[`${rel.id}_perdiemBreakdown`];
            
            if (relBreakdown) {
              // Check daily breakdown
              const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                   'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                .some(day => parseFloat(data[`${rel.id}_${day}`] || '0') > 0);
              if (hasDailyData) {
                hasPerDiemData = true;
              }
            } else if (relAmount > 0) {
              hasPerDiemData = true;
            }
          }
        }
      } else {
        // For single client, check basic fields
        hasHourlyData = parseFloat(data.hours || '0') > 0 || 
                       parseFloat(data.otHours || '0') > 0 || 
                       parseFloat(data.holidayHours || '0') > 0;
        
        // For single client, also check if there are relationship-specific fields
        if (emp.clientPayTypeRelationships) {
          const clientRelationship = emp.clientPayTypeRelationships.find(rel => 
            rel.clientId === selectedClientId
          );
          
          if (clientRelationship) {
            if (clientRelationship.payType === 'hourly') {
              // Check for relationship-specific hourly data
              const relHours = parseFloat(data[`${clientRelationship.id}_hours`] || '0');
              const relOtHours = parseFloat(data[`${clientRelationship.id}_otHours`] || '0');
              const relHolidayHours = parseFloat(data[`${clientRelationship.id}_holidayHours`] || '0');
              hasHourlyData = relHours > 0 || relOtHours > 0 || relHolidayHours > 0;
            } else if (clientRelationship.payType === 'perdiem') {
              // Check for relationship-specific per diem data
              const relAmount = parseFloat(data[`${clientRelationship.id}_perdiemAmount`] || '0');
              const relBreakdown = data[`${clientRelationship.id}_perdiemBreakdown`];
              
              if (relBreakdown) {
                // Check daily breakdown
                const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                     'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                  .some(day => parseFloat(data[`${clientRelationship.id}_${day}`] || '0') > 0);
                hasPerDiemData = hasDailyData;
              } else {
                hasPerDiemData = relAmount > 0;
              }
            }
          }
        }
        
        // Fallback to basic fields if no relationship data found
               // Fallback to basic fields if no relationship data found
               if (!hasHourlyData && !hasPerDiemData) {
                // Check basic per diem fields
                hasPerDiemData = parseFloat(calculatePerDiemTotal(data)) > 0;
                
                // Also check basic hourly fields
                hasHourlyData = parseFloat(data.hours || '0') > 0 || 
                               parseFloat(data.otHours || '0') > 0 || 
                               parseFloat(data.holidayHours || '0') > 0;
              }
      }
      
      if (hasHourlyData && hasPerDiemData) {
        // Mixed payment - validate both
        // For multiple clients, we don't need to validate basic fields since data is in relationships
        if (selectedClientId === 'multiple') {
          // Data is already validated in the relationship loop above
          // No additional validation needed here
        } else {
          // Single client validation
          if (emp.clientPayTypeRelationships) {
            const clientRelationship = emp.clientPayTypeRelationships.find(rel => 
              rel.clientId === selectedClientId
            );
            
            if (clientRelationship) {
              if (clientRelationship.payType === 'hourly') {
                // Check relationship-specific hourly data
                const relHours = parseFloat(data[`${clientRelationship.id}_hours`] || '0');
                if (relHours <= 0) {
                  alert(`Please enter valid hours for ${emp.name} (hourly portion)`);
                  return;
                }
              } else if (clientRelationship.payType === 'perdiem') {
                // Check relationship-specific per diem data
                const relBreakdown = data[`${clientRelationship.id}_perdiemBreakdown`];
                if (relBreakdown) {
                  const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                       'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                    .some(day => parseFloat(data[`${clientRelationship.id}_${day}`] || '0') > 0);
                  if (!hasDailyData) {
                    alert(`Please enter per diem amounts for at least one day for ${emp.name} (per diem portion)`);
                    return;
                  }
                } else {
                  const relAmount = parseFloat(data[`${clientRelationship.id}_perdiemAmount`] || '0');
                  if (relAmount <= 0) {
                    alert(`Please enter a valid per diem amount for ${emp.name} (per diem portion)`);
                    return;
                  }
                }
              }
            } else {
              // Fallback to basic fields if no relationship found
              if (!data.hours || parseFloat(data.hours) <= 0) {
                alert(`Please enter valid hours for ${emp.name} (hourly portion)`);
                return;
              }
              if (data.perdiemBreakdown) {
                const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                     'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                  .some(day => data[day as keyof PayInput] && parseFloat(data[day as keyof PayInput] as string) > 0);
                if (!hasDailyData) {
                  alert(`Please enter per diem amounts for at least one day for ${emp.name} (per diem portion)`);
                  return;
                }
              } else if (!data.perdiemAmount || parseFloat(data.perdiemAmount) <= 0) {
                alert(`Please enter a valid per diem amount for ${emp.name} (per diem portion)`);
                return;
              }
            }
          } else {
            // No relationships - use basic fields
            if (!data.hours || parseFloat(data.hours) <= 0) {
              alert(`Please enter valid hours for ${emp.name} (hourly portion)`);
              return;
            }
            if (data.perdiemBreakdown) {
              const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                   'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                .some(day => data[day as keyof PayInput] && parseFloat(data[day as keyof PayInput] as string) > 0);
              if (!hasDailyData) {
                alert(`Please enter per diem amounts for at least one day for ${emp.name} (per diem portion)`);
                return;
              }
            } else if (!data.perdiemAmount || parseFloat(data.perdiemAmount) <= 0) {
              alert(`Please enter a valid per diem amount for ${emp.name} (per diem portion)`);
              return;
            }
          }
        }
      } else if (hasHourlyData) {
        // Only hourly data - validate hours
        if (selectedClientId === 'multiple') {
          // Data is already validated in the relationship loop above
          // No additional validation needed here
        } else {
          // Single client validation
          if (emp.clientPayTypeRelationships) {
            const clientRelationship = emp.clientPayTypeRelationships.find(rel => 
              rel.clientId === selectedClientId
            );
            
            if (clientRelationship && clientRelationship.payType === 'hourly') {
              // Check relationship-specific hourly data
              const relHours = parseFloat(data[`${clientRelationship.id}_hours`] || '0');
              if (relHours <= 0) {
                alert(`Please enter valid hours for ${emp.name}`);
                return;
              }
            } else {
              // Fallback to basic fields
              if (!data.hours || parseFloat(data.hours) <= 0) {
                alert(`Please enter valid hours for ${emp.name}`);
                return;
              }
            }
          } else {
            // No relationships - use basic fields
            if (!data.hours || parseFloat(data.hours) <= 0) {
              alert(`Please enter valid hours for ${emp.name}`);
              return;
            }
          }
        }
      } else if (hasPerDiemData) {
        // Only per diem data - validate per diem
        if (selectedClientId === 'multiple') {
          // Data is already validated in the relationship loop above
          // No additional validation needed here
        } else {
          // Single client validation
          if (emp.clientPayTypeRelationships) {
            const clientRelationship = emp.clientPayTypeRelationships.find(rel => 
              rel.clientId === selectedClientId
            );
            
            if (clientRelationship && clientRelationship.payType === 'perdiem') {
              // Check relationship-specific per diem data
              const relBreakdown = data[`${clientRelationship.id}_perdiemBreakdown`];
              if (relBreakdown) {
                const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                     'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                  .some(day => parseFloat(data[`${clientRelationship.id}_${day}`] || '0') > 0);
                if (!hasDailyData) {
                  alert(`Please enter per diem amounts for at least one day for ${emp.name}`);
                  return;
                }
              } else {
                const relAmount = parseFloat(data[`${clientRelationship.id}_perdiemAmount`] || '0');
                if (relAmount <= 0) {
                  alert(`Please enter a valid per diem amount for ${emp.name}`);
                  return;
                }
              }
            } else {
              // Fallback to basic fields
              if (data.perdiemBreakdown) {
                const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                     'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                  .some(day => data[day as keyof PayInput] && parseFloat(data[day as keyof PayInput] as string) > 0);
                if (!hasDailyData) {
                  alert(`Please enter per diem amounts for at least one day for ${emp.name}`);
                  return;
                }
              } else if (!data.perdiemAmount || parseFloat(data.perdiemAmount) <= 0) {
                alert(`Please enter a valid per diem amount for ${emp.name}`);
                return;
              }
            }
          } else {
            // No relationships - use basic fields
            if (data.perdiemBreakdown) {
              const hasDailyData = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                   'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                .some(day => data[day as keyof PayInput] && parseFloat(data[day as keyof PayInput] as string) > 0);
              if (!hasDailyData) {
                alert(`Please enter per diem amounts for at least one day for ${emp.name}`);
                return;
              }
            } else if (!data.perdiemAmount || parseFloat(data.perdiemAmount) <= 0) {
              alert(`Please enter a valid per diem amount for ${emp.name}`);
              return;
            }
          }
        }
      } else {
        // No data at all
        alert(`Please enter either hourly or per diem data for ${emp.name}`);
        return;
      }
    }

    setIsCreatingChecks(true);

    try {
      // ✅ FIXED: Get nextCheckNumber from BANK, not company
      console.log("🔍 DEBUG: Getting nextCheckNumber from BANK...");
      console.log("🔍 DEBUG: Company ID:", selectedCompanyId);
      
      // First, get the bank associated with this company
      const banksQuery = query(collection(db, "banks"), where("companyId", "==", selectedCompanyId));
      console.log("🔍 DEBUG: Executing bank query:", {
        collection: "banks",
        whereField: "companyId",
        whereValue: selectedCompanyId
      });
      
      const banksSnapshot = await getDocs(banksQuery);
      console.log("🔍 DEBUG: Bank query result:", {
        empty: banksSnapshot.empty,
        size: banksSnapshot.size,
        docs: banksSnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))
      });
      
      if (banksSnapshot.empty) {
        console.error("❌ ERROR: No bank found for company:", selectedCompanyId);
        throw new Error(`No bank found for company ${selectedCompanyId}`);
      }
      
      const bankDoc = banksSnapshot.docs[0];
      const bankId = bankDoc.id;
      const bankData = bankDoc.data();
      
      console.log("🔍 DEBUG: Found bank:", {
        bankId: bankId,
        bankName: bankData.bankName,
        companyId: bankData.companyId,
        currentNextCheckNumber: bankData.nextCheckNumber
      });
      
      // Get the next check number from bank
      const nextCheckNumber = (bankData.nextCheckNumber || 1);
      console.log("🔍 DEBUG: Using nextCheckNumber from bank:", nextCheckNumber);
      
      // Calculate the week key for the current date
      const weekKey = new Date().toISOString().slice(0, 10);
      
      // Create checks for each selected employee
      const createdChecks: any[] = [];
      
      console.log(`🔍 [CreateChecks] Starting check creation for ${selectedEmployeeIds.length} employees`);
      for (const empId of selectedEmployeeIds) {
        const emp = employees.find((e) => e.id === empId);
        if (!emp) {
          console.log(`🚫 [CreateChecks] Skipping employee ${empId} - not found`);
          continue;
        }

        // Find the data from the correct tab
        let data = null;
        let sourceTabId = null;
        for (const clientId of Object.keys(tabData)) {
          const tabInputs = tabData[clientId]?.inputs || {};
          if (tabInputs[empId]) {
            data = tabInputs[empId];
            sourceTabId = clientId;
            break;
          }
        }
        
        if (!data) {
          console.log(`🚫 [CreateChecks] Skipping ${emp.name} - no input data`);
          continue;
        }
        console.log(`🏗️ [CreateChecks] Creating check for ${emp.name}`);

        // Determine client and pay type based on where the data came from (sourceTabId)
        let clientId = sourceTabId || selectedClientId;
        let payType = emp.payType;
        let relationshipDetails: Array<{ id: string; clientId: string; clientName: string; payType: string; payRate?: number }> = [];
        let selectedRelationshipIds: string[] = [];

        if (sourceTabId === 'multiple' || selectedClientId === 'multiple') {
          // Multiple clients: use selected relationships
          clientId = 'multiple';
          payType = 'mixed';
          if (data.selectedRelationshipIds && data.selectedRelationshipIds.length > 0) {
            selectedRelationshipIds = data.selectedRelationshipIds;
            relationshipDetails = emp.clientPayTypeRelationships
              ?.filter(rel => data.selectedRelationshipIds?.includes(rel.id))
              .map(rel => ({
                id: rel.id,
                clientId: rel.clientId,
                clientName: rel.clientName,
                payType: rel.payType,
                payRate: rel.payRate ? parseFloat(rel.payRate) : (emp.payRate || 0)
              })) || [];
          }
        } else if (clientId && clientId !== 'multiple') {
          // Single client: determine pay type from client name (use the actual source tab client)
          const client = companyClients.find(c => c.id === clientId);
          if (client) {
            if (client.name.toLowerCase().includes('per diem')) {
              payType = 'perdiem';
            } else if (client.name.toLowerCase().includes('hourly')) {
              payType = 'hourly';
            }
          }
          
          // Create default relationship for single client
          relationshipDetails = [{
            id: 'default',
            clientId: clientId,
            clientName: client?.name || 'Unknown Client',
            payType: payType
          }];
        }

        // Calculate amounts
        const hourlyTotal = calculateHourlyTotal(emp, data);
        const perDiemTotal = calculatePerDiemTotal(data);
        const totalAmount = calculateAmount(emp, data);
        
        console.log(`💰 [CREATE CHECK] ${emp.name}: totalAmount = $${totalAmount} (hourly: $${hourlyTotal}, perdiem: $${perDiemTotal})`);

        // Prepare check data
        const checkData: any = {
          companyId: selectedCompanyId,
          employeeName: emp.name,
          employeeId: emp.id,
          amount: totalAmount,
          hours: (() => {
            // Check for relationship-specific hourly data first (when employee has relationships)
            if (clientId !== 'multiple') {
              const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === clientId);
              if (relationship && relationship.payType === 'hourly') {
                const relId = relationship.id;
                const relHours = data[`${relId}_hours`];
                if (relHours && relHours !== '') {
                  return parseFloat(relHours);
                }
              }
            }
            // Fallback to basic hours field
            return data.hours && data.hours !== '' ? parseFloat(data.hours) : 0;
          })(),
          otHours: (() => {
            // Check for relationship-specific OT hours data first
            if (clientId !== 'multiple') {
              const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === clientId);
              if (relationship && relationship.payType === 'hourly') {
                const relId = relationship.id;
                const relOtHours = data[`${relId}_otHours`];
                if (relOtHours && relOtHours !== '') {
                  return parseFloat(relOtHours);
                }
              }
            }
            // Fallback to basic otHours field
            return data.otHours && data.otHours !== '' ? parseFloat(data.otHours) : 0;
          })(),
          holidayHours: (() => {
            // Check for relationship-specific holiday hours data first
            if (clientId !== 'multiple') {
              const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === clientId);
              if (relationship && relationship.payType === 'hourly') {
                const relId = relationship.id;
                const relHolidayHours = data[`${relId}_holidayHours`];
                if (relHolidayHours && relHolidayHours !== '') {
                  return parseFloat(relHolidayHours);
                }
              }
            }
            // Fallback to basic holidayHours field
            return data.holidayHours && data.holidayHours !== '' ? parseFloat(data.holidayHours) : 0;
          })(),
          memo: data.memo || '',
          paymentMethods: data.paymentMethods || [payType],
          selectedRelationshipIds: selectedRelationshipIds.length > 0 ? selectedRelationshipIds : [],
          relationshipDetails: relationshipDetails,
          clientId: clientId,
          payType: payType,
          payRate: emp.payRate?.toString() || '',
          weekKey: weekKey,
          workWeek: `Work Week ${getISOWeek(new Date())}`,
          date: new Date(),
          createdBy: auth.currentUser?.uid,
          reviewed: false,
          paid: false,
          checkNumber: nextCheckNumber + createdChecks.length,
        };

        // For relationship-based checks, populate basic fields from relationship data
        if (selectedClientId === 'multiple' && relationshipDetails.length > 0) {
          // Calculate total hours from all hourly relationships
          let totalHours = 0;
          let totalPerDiemAmount = 0;
          
          // For per diem relationships, we need to aggregate the daily breakdown
          let aggregatedPerDiemData = {
            perdiemMonday: 0,
            perdiemTuesday: 0,
            perdiemWednesday: 0,
            perdiemThursday: 0,
            perdiemFriday: 0,
            perdiemSaturday: 0,
            perdiemSunday: 0
          };
          
          // Store individual relationship hours for proper display in modal
          let relationshipHours: { [key: string]: number } = {};
          
                  // Debug: Log the data structure for per diem relationships
        console.log("🔍 DEBUG: Data structure for per diem aggregation:", {
          dataKeys: Object.keys(data),
          perdiemFields: Object.keys(data).filter(key => key.includes('perdiem')),
          relationshipDetails: relationshipDetails,
          fullData: data
        });
          
          for (const rel of relationshipDetails) {
            if (rel.payType === 'hourly') {
              // Get hours for this specific relationship
              const relHours = parseFloat((data as any)[`${rel.id}_hours`] || '0');
              totalHours += relHours;
              
              // Store the hours for this specific relationship
              relationshipHours[rel.id] = relHours;
            } else if (rel.payType === 'perdiem') {
              // Debug: Log what we're looking for and what we find
              console.log("🔍 DEBUG: Processing per diem relationship:", {
                relationshipId: rel.id,
                relationshipName: rel.clientName,
                dataKeys: Object.keys(data),
                perdiemAmountField: `${rel.id}_perdiemAmount`,
                perdiemAmountValue: (data as any)[`${rel.id}_perdiemAmount`],
                perdiemMondayField: `${rel.id}_perdiemMonday`,
                perdiemMondayValue: (data as any)[`${rel.id}_perdiemMonday`],
                allPerdiemFields: Object.keys(data).filter(key => key.includes(rel.id) && key.includes('perdiem')),
                actualPerdiemValues: {
                  monday: (data as any)[`${rel.id}_perdiemMonday`],
                  tuesday: (data as any)[`${rel.id}_perdiemTuesday`],
                  wednesday: (data as any)[`${rel.id}_perdiemWednesday`],
                  thursday: (data as any)[`${rel.id}_perdiemThursday`],
                  friday: (data as any)[`${rel.id}_perdiemFriday`],
                  saturday: (data as any)[`${rel.id}_perdiemSaturday`],
                  sunday: (data as any)[`${rel.id}_perdiemSunday`]
                }
              });
              
              // Get per diem amount for this specific relationship
              const relPerDiem = parseFloat((data as any)[`${rel.id}_perdiemAmount`] || '0');
              totalPerDiemAmount += relPerDiem;
              
              // Aggregate daily breakdown from this relationship
              const relPerDiemMonday = parseFloat((data as any)[`${rel.id}_perdiemMonday`] || '0');
              const relPerDiemTuesday = parseFloat((data as any)[`${rel.id}_perdiemTuesday`] || '0');
              const relPerDiemWednesday = parseFloat((data as any)[`${rel.id}_perdiemWednesday`] || '0');
              const relPerDiemThursday = parseFloat((data as any)[`${rel.id}_perdiemThursday`] || '0');
              const relPerDiemFriday = parseFloat((data as any)[`${rel.id}_perdiemFriday`] || '0');
              const relPerDiemSaturday = parseFloat((data as any)[`${rel.id}_perdiemSaturday`] || '0');
              const relPerDiemSunday = parseFloat((data as any)[`${rel.id}_perdiemSunday`] || '0');
              
              aggregatedPerDiemData.perdiemMonday += relPerDiemMonday;
              aggregatedPerDiemData.perdiemTuesday += relPerDiemTuesday;
              aggregatedPerDiemData.perdiemWednesday += relPerDiemWednesday;
              aggregatedPerDiemData.perdiemThursday += relPerDiemThursday;
              aggregatedPerDiemData.perdiemFriday += relPerDiemFriday;
              aggregatedPerDiemData.perdiemSaturday += relPerDiemSaturday;
              aggregatedPerDiemData.perdiemSunday += relPerDiemSunday;
            }
          }
          
          // Update the basic fields so PDF generator can access them
          checkData.hours = totalHours;
          checkData.perdiemAmount = totalPerDiemAmount > 0 ? totalPerDiemAmount : undefined;
          
          // Store relationship-specific hours for proper display in modal
          checkData.relationshipHours = relationshipHours;
          console.log(`🔍 DEBUG: Saving relationshipHours for ${emp.name}:`, relationshipHours);
        
        // Debug: Log all relationship-specific data being saved
        const relationshipSpecificFields = Object.keys(checkData).filter(key => 
          key.includes('_perdiem') || key.includes('_hours')
        );
        if (relationshipSpecificFields.length > 0) {
          console.log(`🔍 DEBUG: Saving relationship-specific fields for ${emp.name}:`, 
            relationshipSpecificFields.reduce((acc: any, key) => {
              acc[key] = checkData[key];
              return acc;
            }, {})
          );
        }
          
          // Set the aggregated daily breakdown fields
          // Check if any daily amounts are entered
          const hasDailyAmounts = Object.values(aggregatedPerDiemData).some(amount => amount > 0);
          
          if (totalPerDiemAmount > 0 || hasDailyAmounts) {
            checkData.perdiemBreakdown = hasDailyAmounts; // true if daily amounts, false if only total
            
            // Only add daily fields if they have values > 0
            if (aggregatedPerDiemData.perdiemMonday > 0) checkData.perdiemMonday = aggregatedPerDiemData.perdiemMonday;
            if (aggregatedPerDiemData.perdiemTuesday > 0) checkData.perdiemTuesday = aggregatedPerDiemData.perdiemTuesday;
            if (aggregatedPerDiemData.perdiemWednesday > 0) checkData.perdiemWednesday = aggregatedPerDiemData.perdiemWednesday;
            if (aggregatedPerDiemData.perdiemThursday > 0) checkData.perdiemThursday = aggregatedPerDiemData.perdiemThursday;
            if (aggregatedPerDiemData.perdiemFriday > 0) checkData.perdiemFriday = aggregatedPerDiemData.perdiemFriday;
            if (aggregatedPerDiemData.perdiemSaturday > 0) checkData.perdiemSaturday = aggregatedPerDiemData.perdiemSaturday;
            if (aggregatedPerDiemData.perdiemSunday > 0) checkData.perdiemSunday = aggregatedPerDiemData.perdiemSunday;
          }
        }

        // Add per diem fields only if they have values (for single-client checks only)
        if (clientId !== 'multiple') {
          // Check for relationship-specific per diem data first (when employee has relationships)
          const relationship = emp.clientPayTypeRelationships?.find(rel => rel.clientId === clientId);
          if (relationship && relationship.payType === 'perdiem') {
            // Use relationship-specific fields
            const relId = relationship.id;
            if (data[`${relId}_perdiemBreakdown`] !== undefined) {
              checkData.perdiemBreakdown = data[`${relId}_perdiemBreakdown`];
            }
            if (data[`${relId}_perdiemAmount`] && parseFloat(data[`${relId}_perdiemAmount`]) > 0) {
              checkData.perdiemAmount = parseFloat(data[`${relId}_perdiemAmount`]);
            }
            if (data[`${relId}_perdiemMonday`] !== undefined && data[`${relId}_perdiemMonday`] !== '') {
              checkData.perdiemMonday = parseFloat(data[`${relId}_perdiemMonday`]);
            }
            if (data[`${relId}_perdiemTuesday`] !== undefined && data[`${relId}_perdiemTuesday`] !== '') {
              checkData.perdiemTuesday = parseFloat(data[`${relId}_perdiemTuesday`]);
            }
            if (data[`${relId}_perdiemWednesday`] !== undefined && data[`${relId}_perdiemWednesday`] !== '') {
              checkData.perdiemWednesday = parseFloat(data[`${relId}_perdiemWednesday`]);
            }
            if (data[`${relId}_perdiemThursday`] !== undefined && data[`${relId}_perdiemThursday`] !== '') {
              checkData.perdiemThursday = parseFloat(data[`${relId}_perdiemThursday`]);
            }
            if (data[`${relId}_perdiemFriday`] !== undefined && data[`${relId}_perdiemFriday`] !== '') {
              checkData.perdiemFriday = parseFloat(data[`${relId}_perdiemFriday`]);
            }
            if (data[`${relId}_perdiemSaturday`] !== undefined && data[`${relId}_perdiemSaturday`] !== '') {
              checkData.perdiemSaturday = parseFloat(data[`${relId}_perdiemSaturday`]);
            }
            if (data[`${relId}_perdiemSunday`] !== undefined && data[`${relId}_perdiemSunday`] !== '') {
              checkData.perdiemSunday = parseFloat(data[`${relId}_perdiemSunday`]);
            }
          } else {
            // Fallback to basic per diem fields (legacy support)
            if (data.perdiemBreakdown !== undefined) {
              checkData.perdiemBreakdown = data.perdiemBreakdown;
            }
            if (data.perdiemAmount && parseFloat(data.perdiemAmount) > 0) {
              checkData.perdiemAmount = parseFloat(data.perdiemAmount);
            }
            if (data.perdiemMonday !== undefined && data.perdiemMonday !== '') {
              checkData.perdiemMonday = parseFloat(data.perdiemMonday);
            }
            if (data.perdiemTuesday !== undefined && data.perdiemTuesday !== '') {
              checkData.perdiemTuesday = parseFloat(data.perdiemTuesday);
            }
            if (data.perdiemWednesday !== undefined && data.perdiemWednesday !== '') {
              checkData.perdiemWednesday = parseFloat(data.perdiemWednesday);
            }
            if (data.perdiemThursday !== undefined && data.perdiemThursday !== '') {
              checkData.perdiemThursday = parseFloat(data.perdiemThursday);
            }
            if (data.perdiemFriday !== undefined && data.perdiemFriday !== '') {
              checkData.perdiemFriday = parseFloat(data.perdiemFriday);
            }
            if (data.perdiemSaturday !== undefined && data.perdiemSaturday !== '') {
              checkData.perdiemSaturday = parseFloat(data.perdiemSaturday);
            }
            if (data.perdiemSunday !== undefined && data.perdiemSunday !== '') {
              checkData.perdiemSunday = parseFloat(data.perdiemSunday);
            }
          }
        }

        // Store relationship-specific data for future restoration
        if (relationshipDetails && relationshipDetails.length > 0) {
          for (const rel of relationshipDetails) {
            const relId = rel.id;
            
            // Store relationship-specific hourly data
            if (rel.payType === 'hourly') {
              if (data[`${relId}_hours`] !== undefined && data[`${relId}_hours`] !== '') {
                checkData[`${relId}_hours`] = parseFloat(data[`${relId}_hours`]);
              }
              if (data[`${relId}_otHours`] !== undefined && data[`${relId}_otHours`] !== '') {
                checkData[`${relId}_otHours`] = parseFloat(data[`${relId}_otHours`]);
              }
              if (data[`${relId}_holidayHours`] !== undefined && data[`${relId}_holidayHours`] !== '') {
                checkData[`${relId}_holidayHours`] = parseFloat(data[`${relId}_holidayHours`]);
              }
            }
            
            // Store relationship-specific per diem data
            if (rel.payType === 'perdiem') {
              if (data[`${relId}_perdiemAmount`] !== undefined && data[`${relId}_perdiemAmount`] !== '') {
                checkData[`${relId}_perdiemAmount`] = parseFloat(data[`${relId}_perdiemAmount`]);
              }
              if (data[`${relId}_perdiemBreakdown`] !== undefined) {
                checkData[`${relId}_perdiemBreakdown`] = data[`${relId}_perdiemBreakdown`];
              }
              if (data[`${relId}_perdiemMonday`] !== undefined && data[`${relId}_perdiemMonday`] !== '') {
                checkData[`${relId}_perdiemMonday`] = parseFloat(data[`${relId}_perdiemMonday`]);
              }
              if (data[`${relId}_perdiemTuesday`] !== undefined && data[`${relId}_perdiemTuesday`] !== '') {
                checkData[`${relId}_perdiemTuesday`] = parseFloat(data[`${relId}_perdiemTuesday`]);
              }
              if (data[`${relId}_perdiemWednesday`] !== undefined && data[`${relId}_perdiemWednesday`] !== '') {
                checkData[`${relId}_perdiemWednesday`] = parseFloat(data[`${relId}_perdiemWednesday`]);
              }
              if (data[`${relId}_perdiemThursday`] !== undefined && data[`${relId}_perdiemThursday`] !== '') {
                checkData[`${relId}_perdiemThursday`] = parseFloat(data[`${relId}_perdiemThursday`]);
              }
              if (data[`${relId}_perdiemFriday`] !== undefined && data[`${relId}_perdiemFriday`] !== '') {
                checkData[`${relId}_perdiemFriday`] = parseFloat(data[`${relId}_perdiemFriday`]);
              }
              if (data[`${relId}_perdiemSaturday`] !== undefined && data[`${relId}_perdiemSaturday`] !== '') {
                checkData[`${relId}_perdiemSaturday`] = parseFloat(data[`${relId}_perdiemSaturday`]);
              }
              if (data[`${relId}_perdiemSunday`] !== undefined && data[`${relId}_perdiemSunday`] !== '') {
                checkData[`${relId}_perdiemSunday`] = parseFloat(data[`${relId}_perdiemSunday`]);
              }
            }
          }
        }

        // Clean up the data - ensure no undefined values and set proper defaults
        Object.keys(checkData).forEach(key => {
          if (checkData[key] === undefined) {
            // Set appropriate defaults based on field type
            if (key === 'hours' || key === 'otHours' || key === 'holidayHours') {
              checkData[key] = 0;
            } else if (key === 'memo' || key === 'payRate') {
              checkData[key] = '';
            } else if (key === 'selectedRelationshipIds' || key === 'relationshipDetails') {
              checkData[key] = [];
            } else if (key === 'perdiemAmount') {
              checkData[key] = 0;
            } else if (key.startsWith('perdiem') && key !== 'perdiemBreakdown') {
              // Don't override per diem fields that were set by relationship aggregation
              // Only set to 0 if they weren't set by the aggregation logic above
              if (!checkData.relationshipDetails || checkData.relationshipDetails.length === 0) {
                checkData[key] = 0;
              }
            }
          }
        });

        // Add relationshipDetails to checkData for proper display
        checkData.relationshipDetails = relationshipDetails;
        checkData.selectedRelationshipIds = selectedRelationshipIds;

        console.log("🔍 DEBUG: Data after cleanup:", checkData);
        console.log("🔍 DEBUG: Saving check data with relationships:", relationshipDetails.length, checkData);
        console.log("🔍 DEBUG: relationshipDetails:", relationshipDetails);
        
        // 🔍 SPECIFIC DEBUG: Log per diem data being saved to database
        const perdiemDataBeingSaved = {
          employeeName: checkData.employeeName,
          perdiemAmount: checkData.perdiemAmount,
          perdiemBreakdown: checkData.perdiemBreakdown,
          dailyAmounts: {
            perdiemMonday: checkData.perdiemMonday,
            perdiemTuesday: checkData.perdiemTuesday,
            perdiemWednesday: checkData.perdiemWednesday,
            perdiemThursday: checkData.perdiemThursday,
            perdiemFriday: checkData.perdiemFriday,
            perdiemSaturday: checkData.perdiemSaturday,
            perdiemSunday: checkData.perdiemSunday
          },
          relationshipSpecificFields: Object.keys(checkData).filter(key => key.includes('_perdiem')).reduce((acc: any, key) => {
            acc[key] = checkData[key];
            return acc;
          }, {})
        };
        console.log("💾 [SAVE] Per diem data being saved to database:", perdiemDataBeingSaved);
        
        console.log("🔍 DEBUG: Check data to be saved:", JSON.stringify(checkData, null, 2));

        // Save to Firestore
        const checkRef = doc(collection(db, "checks"));
        console.log("🔍 DEBUG: Check reference created:", checkRef.path);
        console.log("🔍 DEBUG: About to save check with data:", {
          companyId: checkData.companyId,
          employeeName: checkData.employeeName,
          amount: checkData.amount,
          hours: checkData.hours,
          payType: checkData.payType,
          employeeId: checkData.employeeId,
          clientId: checkData.clientId,
          weekKey: checkData.weekKey,
          createdBy: checkData.createdBy,
          reviewed: checkData.reviewed,
          paid: checkData.paid,
          checkNumber: checkData.checkNumber
        });

        try {
          await setDoc(checkRef, checkData);
          console.log("✅ Check saved successfully!");
          createdChecks.push(checkData);
        } catch (saveError: any) {
          console.log("❌ Error saving individual check:", {
            message: saveError.message,
            code: saveError.code,
            stack: saveError.stack
          });
          throw saveError; // Re-throw to maintain existing error handling
        }
      }

      // ✅ FIXED: Update BANK's nextCheckNumber, not company
      if (createdChecks.length > 0) {
        console.log("🔍 DEBUG: About to update BANK with new check number");
        console.log("🔍 DEBUG: Bank ID:", bankId);
        console.log("🔍 DEBUG: Current nextCheckNumber:", nextCheckNumber);
        console.log("🔍 DEBUG: Created checks count:", createdChecks.length);
        console.log("🔍 DEBUG: New nextCheckNumber will be:", nextCheckNumber + createdChecks.length);
        
        const bankRef = doc(db, "banks", bankId);
        console.log("🔍 DEBUG: Bank reference created:", bankRef.path);
        
        try {
          await updateDoc(bankRef, {
            nextCheckNumber: nextCheckNumber + createdChecks.length
          });
          console.log("✅ Bank updated successfully!");
        } catch (bankUpdateError: any) {
          console.log("❌ Error updating bank:", {
            message: bankUpdateError.message,
            code: bankUpdateError.code,
            stack: bankUpdateError.stack
          });
          throw bankUpdateError;
        }
      }

      console.log("🔍 DEBUG: All operations completed successfully, about to show success message");
      console.log(`✅ Successfully created ${createdChecks.length} checks`);
      
      // Trigger refresh of checks data immediately
      if (onChecksCreated) {
        onChecksCreated();
      }
      
      // Show success message
      setSuccessMessageText(`Successfully created ${createdChecks.length} checks!`);
      setShowSuccessMessage(true);
      // Auto-hide after 4 seconds
      setTimeout(() => setShowSuccessMessage(false), 4000);
      
      // Show floating menu with navigation options (capture current state before clearing)
      const company = companies.find(c => c.id === selectedCompanyId);
      const client = selectedClientId !== 'multiple' ? clients.find(c => c.id === selectedClientId) : null;
      
      // Set floating menu with a slight delay to ensure it appears properly
      setTimeout(() => {
        setFloatingMenu({
          open: true,
          companyId: selectedCompanyId,
          clientId: selectedClientId !== 'multiple' ? selectedClientId : null,
          checkId: createdChecks[0]?.id || null,
          companyName: company?.name || 'Unknown Company',
          clientName: client?.name || 'Multiple Clients'
        });
      }, 100);
      
      // Clear selections and inputs after a delay to avoid interfering with floating menu
      setTimeout(() => {
        setSelectedEmployees({});
        setInputs({});
        setSelectedClientId('');
      }, 200);

    } catch (error: any) {
      console.error("❌ Error creating checks:", error);
      console.error("❌ Full error details:", {
        message: error.message,
        code: error.code,
        stack: error.stack,
        name: error.name
      });
      
      // Try to provide more specific error information
      if (error.code === 'permission-denied') {
        console.error("❌ Permission denied - check Firestore rules");
      } else if (error.code === 'unavailable') {
        console.error("❌ Service unavailable - check network connection");
      } else if (error.code === 'not-found') {
        console.error("❌ Collection not found");
      } else if (error.code === 'invalid-argument') {
        console.error("❌ Invalid argument - check data format");
      } else if (error.code === 'failed-precondition') {
        console.error("❌ Failed precondition - check data requirements");
      }
      
      alert("Error creating checks. Please try again.");
    } finally {
      setIsCreatingChecks(false);
    }
  };

  const reviewChecks = () => {
    if (!selectedCompanyId) {
      alert("Please select a company first.");
      return;
    }

    // Get data from current tab
    const currentTabId = selectedClientId || 'multiple';
    console.log(`🚀🚀🚀 [Review] NEW reviewChecks function called - collecting from ALL tabs 🚀🚀🚀`);
    
    // Collect ALL selected employees and employees with data from ALL tabs
    const allSelectedEmployeeIds: string[] = [];
    const employeesWithInputData: string[] = [];
    
    // Go through all tabs and collect selected employees and those with input data
    Object.keys(tabData).forEach(tabId => {
      const tabSelectedEmployees = tabData[tabId]?.selectedEmployees || {};
      const tabInputs = tabData[tabId]?.inputs || {};
      
      // Add selected employees from this tab
      Object.keys(tabSelectedEmployees).forEach(empId => {
        if (tabSelectedEmployees[empId] && !allSelectedEmployeeIds.includes(empId)) {
          allSelectedEmployeeIds.push(empId);
        }
      });
      
      // Add employees with input data from this tab
      Object.keys(tabInputs).forEach(empId => {
        const data = tabInputs[empId];
        if (!data || employeesWithInputData.includes(empId)) return;
        
        // Check if employee has any meaningful input data
        const hasHourlyData = parseFloat(data.hours || '0') > 0 || 
                             parseFloat(data.otHours || '0') > 0 || 
                             parseFloat(data.holidayHours || '0') > 0;
        const hasPerDiemData = parseFloat(data.perdiemAmount || '0') > 0 || 
                              parseFloat(data.perdiemMonday || '0') > 0 ||
                              parseFloat(data.perdiemTuesday || '0') > 0 ||
                              parseFloat(data.perdiemWednesday || '0') > 0 ||
                              parseFloat(data.perdiemThursday || '0') > 0 ||
                              parseFloat(data.perdiemFriday || '0') > 0 ||
                              parseFloat(data.perdiemSaturday || '0') > 0 ||
                              parseFloat(data.perdiemSunday || '0') > 0;
        
        // Check relationship-specific data
        const hasRelationshipData = Object.keys(data).some(key => {
          if (key.includes('_hours') || key.includes('_otHours') || key.includes('_holidayHours')) {
            return parseFloat(data[key] || '0') > 0;
          }
          if (key.includes('_perdiemAmount') || key.includes('_perdiem')) {
            return parseFloat(data[key] || '0') > 0;
          }
          return false;
        });
        
        if (hasHourlyData || hasPerDiemData || hasRelationshipData) {
          employeesWithInputData.push(empId);
        }
      });
    });
    
    // Combine selected employees and employees with data (remove duplicates)
    const combinedEmployeeIds = [...allSelectedEmployeeIds, ...employeesWithInputData];
    const selectedEmployeeIds = Array.from(new Set(combinedEmployeeIds));
    
    console.log(`🔍 [Review] All selected employees:`, allSelectedEmployeeIds);
    console.log(`🔍 [Review] Employees with input data:`, employeesWithInputData);
    console.log(`🔍 [Review] Final combined for review:`, selectedEmployeeIds);
    console.log(`🔍 [Review] Total count for review:`, selectedEmployeeIds.length);

    if (selectedEmployeeIds.length === 0) {
      alert("Please select at least one employee.");
      return;
    }

    console.log(`🔍 [Review] selectedClientId: ${selectedClientId}`);
    console.log(`🔍 [Review] companyClients:`, companyClients.map(c => ({ id: c.id, name: c.name })));

    // Prepare review data - collect data from ALL tabs
    const reviewDataArray = selectedEmployeeIds.map(empId => {
      const emp = employees.find((e) => e.id === empId);
      if (!emp) return null;
      
      // Find the employee's data from any tab
      let data = null;
      for (const tabId of Object.keys(tabData)) {
        const tabInputs = tabData[tabId]?.inputs || {};
        if (tabInputs[empId]) {
          data = tabInputs[empId];
          break; // Use the first tab where we find data for this employee
        }
      }
      
      if (!data) return null;

      return {
        employee: emp,
        input: data,
        calculatedAmount: parseFloat(calculateAmount(emp, data)),
        hourlyTotal: parseFloat(calculateHourlyTotal(emp, data)),
        perDiemTotal: parseFloat(calculatePerDiemTotal(data))
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    setReviewData(reviewDataArray);
    setShowReviewPanel(true);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Batch Checks
      </Typography>

      {!selectedCompanyId ? (
        <>

          
          <Typography variant="h5" gutterBottom sx={{ mb: 3, fontWeight: 'bold', color: 'text.primary' }}>
            Select a Company
          </Typography>
          
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
            gap: 3,
            maxWidth: 1200
          }}>
            {companies.map((c) => (
              <Box
                key={c.id}
                sx={{
                  border: '2px solid',
                  borderColor: 'grey.200',
                  borderRadius: 3,
                  p: 3,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  backgroundColor: 'white',
                  '&:hover': {
                    borderColor: 'primary.main',
                    backgroundColor: 'primary.50',
                    transform: 'translateY(-2px)',
                    boxShadow: 3
                  },
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onClick={() => setSelectedCompanyId(c.id)}
              >
                {/* Company Logo */}
                <Box sx={{ 
                  display: 'flex', 
                  justifyContent: 'center', 
                  mb: 2,
                  position: 'relative'
                }}>
                  {c.logoBase64 ? (
                    <Avatar
                      src={c.logoBase64}
                      sx={{ 
                        width: 80, 
                        height: 80,
                        border: '3px solid',
                        borderColor: 'grey.300'
                      }}
                    />
                  ) : (
                    <Avatar
                      sx={{ 
                        width: 80, 
                        height: 80,
                        backgroundColor: 'primary.main',
                        fontSize: '2rem',
                        border: '3px solid',
                        borderColor: 'grey.300'
                      }}
                    >
                      {c.name ? c.name[0].toUpperCase() : '?'}
                    </Avatar>
                  )}
                </Box>
                
                {/* Company Name */}
                <Typography 
                  variant="h6" 
                  sx={{ 
                    textAlign: 'center', 
                    fontWeight: 'bold',
                    color: 'text.primary',
                    mb: 1
                  }}
              >
                {c.name}
                </Typography>
                
                {/* Company Info */}
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Click to create checks for this company
                  </Typography>
                </Box>
                
                {/* Employee Count Badge */}
                <Box sx={{ 
                  position: 'absolute', 
                  top: 10, 
                  left: 10,
                  backgroundColor: 'secondary.main',
                  color: 'white',
                  borderRadius: '12px',
                  px: 1.5,
                  py: 0.5,
                  fontSize: '0.75rem',
                  fontWeight: 'bold'
                }}>
                  {employees.filter(emp => 
                    emp.companyId === c.id || 
                    (emp.companyIds && emp.companyIds.includes(c.id))
                  ).length} employees
                </Box>
              </Box>
            ))}
          </Box>
        </>
      ) : (
        <>
          {/* Company Header */}
          <Box sx={{ 
            mb: 3, 
            p: 3, 
            backgroundColor: 'grey.50', 
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'grey.200',
            display: 'flex',
            alignItems: 'center',
            gap: 3
          }}>
            {(() => {
              const selectedCompany = companies.find(c => c.id === selectedCompanyId);
              return (
                <>
                  {selectedCompany?.logoBase64 ? (
                    <Avatar
                      src={selectedCompany.logoBase64}
                      sx={{ 
                        width: 60, 
                        height: 60,
                        border: '2px solid',
                        borderColor: 'primary.main'
                      }}
                    />
                  ) : (
                    <Avatar
                      sx={{ 
                        width: 60, 
                        height: 60,
                        backgroundColor: 'primary.main',
                        fontSize: '1.5rem',
                        border: '2px solid',
                        borderColor: 'primary.main'
                      }}
                    >
                      {selectedCompany?.name ? selectedCompany.name[0].toUpperCase() : '?'}
                    </Avatar>
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      {selectedCompany?.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Creating batch checks for employees
                    </Typography>
                  </Box>
          <Button
            variant="outlined"
            onClick={() => setSelectedCompanyId(null)}
                    sx={{
                      borderRadius: 2,
                      px: 3,
                      py: 1.5,
                      borderWidth: 2,
                      fontWeight: 'bold',
                      '&:hover': {
                        borderWidth: 2,
                        transform: 'translateY(-1px)',
                        boxShadow: 2
                      },
                      transition: 'all 0.2s ease'
                    }}
          >
            ← Back to Companies
          </Button>
                </>
              );
            })()}
          </Box>

          {/* Enhanced Client Selection with Tabs */}
          {companyClients.length > 1 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
                 Select Client for This Work
              </Typography>
              
              {/* Client Tabs */}
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs 
                  value={selectedClientId || 'multiple'} 
                  onChange={(e: React.SyntheticEvent, newValue: string) => setSelectedClientId(newValue)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ 
                    '& .MuiTab-root': { 
                      minHeight: '48px',
                      textTransform: 'none',
                      fontWeight: 'bold'
                    }
                  }}
                >
                  {/* Individual Client Tabs */}
                  {filteredCompanyClients.map((client) => (
                    <Tab
                      key={client.id}
                      label={
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span>{client.name}</span>
                          <Typography variant="caption" color="text.secondary">
                            {(() => {
                              if (client.name.toLowerCase().includes('per diem')) {
                                return employees.filter(emp => {
                                  const hasPerDiemForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                                    rel.clientId === client.id && rel.payType === 'perdiem'
                                  );
                                  const hasLegacyPerDiem = emp.clientId === client.id && emp.payType === 'perdiem';
                                  const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                                  return (hasPerDiemForThisClient || hasLegacyPerDiem) && !hasMultiple;
                                }).length;
                              } else if (client.name.toLowerCase().includes('hourly')) {
                                return employees.filter(emp => {
                                  const hasHourlyForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                                    rel.clientId === client.id && rel.payType === 'hourly'
                                  );
                                  const hasLegacyHourly = emp.clientId === client.id && emp.payType === 'hourly';
                                  const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                                  return (hasHourlyForThisClient || hasLegacyHourly) && !hasMultiple;
                                }).length;
                              } else {
                                return employees.filter(emp => {
                                  const hasThisClient = emp.clientPayTypeRelationships?.some(rel => rel.clientId === client.id) ||
                                                      emp.clientId === client.id;
                                  const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                                  return hasThisClient && !hasMultiple;
                                }).length;
                              }
                            })()} employees
                          </Typography>
                        </Box>
                      }
                      value={client.id}
                      sx={{ 
                        minWidth: '120px',
                        '&.Mui-selected': { 
                          backgroundColor: 'primary.light',
                          color: 'primary.contrastText',
                          borderRadius: '8px 8px 0 0'
                        }
                      }}
                    />
                  ))}
                  
                  {/* Multiple Clients Tab */}
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span>Multiple Clients</span>
                        <Typography variant="caption" color="text.secondary">
                          {employees.filter(emp => 
                            emp.clientPayTypeRelationships && 
                            emp.clientPayTypeRelationships.length > 1
                          ).length} employees
                        </Typography>
                      </Box>
                    }
                    value="multiple"
                    sx={{ 
                      minWidth: '120px',
                      '&.Mui-selected': { 
                        backgroundColor: 'secondary.light',
                        color: 'secondary.contrastText',
                        borderRadius: '8px 8px 0 0'
                      }
                    }}
                  />
                </Tabs>
              </Box>
              
              {/* Tab Content */}
              {/* Empty box removed for cleaner interface */}
              
              {/* Quick Actions */}
              <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    // Clear selections only for the current tab
                    if (selectedClientId && selectedClientId !== 'multiple') {
                      // Single client tab: clear only employees for this client
                      const currentClientEmployees = filteredEmployees.filter(emp => 
                        emp.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId) ||
                        emp.clientId === selectedClientId
                      );
                      
                      const newSelectedEmployees = { ...selectedEmployees };
                      const newInputs = { ...inputs };
                      
                      // Clear selections and inputs only for current client employees
                      currentClientEmployees.forEach(emp => {
                        newSelectedEmployees[emp.id] = false;
                        delete newInputs[emp.id];
                      });
                      
                      setSelectedEmployees(newSelectedEmployees);
                      setInputs(newInputs);
                    } else if (selectedClientId === 'multiple') {
                      // Multiple clients tab: clear only employees with multiple relationships
                      const multipleClientEmployees = filteredEmployees.filter(emp => 
                        emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1
                      );
                      
                      const newSelectedEmployees = { ...selectedEmployees };
                      const newInputs = { ...inputs };
                      
                      // Clear selections and inputs only for multiple client employees
                      multipleClientEmployees.forEach(emp => {
                        newSelectedEmployees[emp.id] = false;
                        delete newInputs[emp.id];
                      });
                      
                      setSelectedEmployees(newSelectedEmployees);
                      setInputs(newInputs);
                    }
                  }}
                  startIcon={<span>🔄</span>}
                >
                  Clear Selection
                </Button>
                {selectedClientId && (
                  <>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        // Auto-select employees for this client
                        const clientEmployees = employees.filter(emp => 
                          emp.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId) ||
                          emp.clientId === selectedClientId
                        );
                        const newSelectedEmployees = { ...selectedEmployees };
                        const newInputs = { ...inputs };
                        
                        clientEmployees.forEach(emp => {
                          newSelectedEmployees[emp.id] = true;
                          // Auto-set payment methods and relationships for this client
                          const defaultPaymentMethods = getDefaultPaymentMethods(emp);
                          const defaultRelationshipIds = getDefaultRelationshipIds(emp);
                          newInputs[emp.id] = {
                            ...newInputs[emp.id],
                            paymentMethods: defaultPaymentMethods,
                            selectedRelationshipIds: defaultRelationshipIds,
                            hours: "",
                            otHours: "",
                            holidayHours: "",
                            memo: "",
                            perdiemAmount: "",
                            perdiemBreakdown: false,
                            perdiemMonday: "",
                            perdiemTuesday: "",
                            perdiemWednesday: "",
                            perdiemThursday: "",
                            perdiemFriday: "",
                            perdiemSaturday: "",
                            perdiemSunday: "",
                          };
                        });
                        
                        setSelectedEmployees(newSelectedEmployees);
                        setInputs(newInputs);
                      }}
                      startIcon={<span>👥</span>}
                    >
                      Select All {companyClients.find(c => c.id === selectedClientId)?.name} Employees
                    </Button>
                    
                    <Button
                      variant="outlined"
                      size="small"
                      color="primary"
                      onClick={usePreviousBatch}
                      startIcon={<span>📋</span>}
                      sx={{
                        borderColor: 'primary.main',
                        '&:hover': {
                          backgroundColor: 'primary.50',
                          borderColor: 'primary.dark',
                        }
                      }}
                    >
                      Use Previous Batch of Checks
                    </Button>
                  </>
                )}
              </Box>
            </Box>
          )}

          {/* Show single client info if only one client */}
          {companyClients.length === 1 && (
            <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Client: <strong>{companyClients[0].name}</strong>
              </Typography>
            </Box>
          )}

          {/* Filter employees based on selected client tab */}
          {(() => {
            // Debug: Log current state
            console.log(`🔍 [Employee Filtering] selectedClientId: ${selectedClientId}, filteredEmployees.length: ${filteredEmployees.length}`);
            
            let employeesToShow = filteredEmployees;
            
            // Debug: Log employee data for key employees
            const domingo = filteredEmployees.find(emp => emp.name === 'Domingo Perez Lopez');
            if (domingo) {
              console.log('🔍 Domingo Perez Lopez data:', {
                id: domingo.id,
                name: domingo.name,
                clientId: domingo.clientId,
                payType: domingo.payType,
                clientPayTypeRelationships: domingo.clientPayTypeRelationships
              });
            }
            
            if (selectedClientId && selectedClientId !== 'multiple') {
              // Single client tab: show employees for this specific client
              const client = companyClients.find(c => c.id === selectedClientId);
              if (client) {
                console.log(`🔍 Filtering for client: ${client.name} (${client.id})`);
                console.log(`🔍 Total employees before filtering: ${filteredEmployees.length}`);
                
                if (client.name.toLowerCase().includes('per diem')) {
                  // Per Diem tab: show employees with per diem relationships for this client
                  employeesToShow = filteredEmployees.filter(emp => {
                    // Check if employee has relationships with this client and per diem pay type
                    const hasPerDiemForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                      rel.clientId === selectedClientId && rel.payType === 'perdiem'
                    );
                    // Check legacy fields
                    const hasLegacyPerDiem = emp.clientId === selectedClientId && emp.payType === 'perdiem';
                    // Check if employee has multiple relationships (should go to multiple tab)
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    
                    const shouldShow = (hasPerDiemForThisClient || hasLegacyPerDiem) && !hasMultiple;
                    if (emp.name === 'Domingo Perez Lopez') {
                      console.log(`🔍 Domingo: hasPerDiemForThisClient=${hasPerDiemForThisClient}, hasLegacyPerDiem=${hasLegacyPerDiem}, hasMultiple=${hasMultiple}, shouldShow=${shouldShow}`);
                    }
                    return shouldShow;
                  });
                } else if (client.name.toLowerCase().includes('hourly')) {
                  // Hourly tab: show employees with hourly relationships for this client
                  employeesToShow = filteredEmployees.filter(emp => {
                    // Check if employee has relationships with this client and hourly pay type
                    const hasHourlyForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                      rel.clientId === selectedClientId && rel.payType === 'hourly'
                    );
                    // Check legacy fields
                    const hasLegacyHourly = emp.clientId === selectedClientId && emp.payType === 'hourly';
                    // Check if employee has multiple relationships (should go to multiple tab)
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    
                    const shouldShow = (hasHourlyForThisClient || hasLegacyHourly) && !hasMultiple;
                    if (emp.name === 'Domingo Perez Lopez') {
                      console.log(`🔍 Domingo: hasHourlyForThisClient=${hasHourlyForThisClient}, hasLegacyHourly=${hasLegacyHourly}, hasMultiple=${hasMultiple}, shouldShow=${shouldShow}`);
                    }
                    return shouldShow;
                  });
                } else {
                  // Other client tabs: show employees for this specific client (but not multiple)
                  employeesToShow = filteredEmployees.filter(emp => {
                    const hasThisClient = emp.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId) ||
                                        emp.clientId === selectedClientId;
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    return hasThisClient && !hasMultiple;
                  });
                }
                
                console.log(`🔍 Employees after filtering: ${employeesToShow.length}`);
                console.log(`🔍 Employee names:`, employeesToShow.map(emp => emp.name));
              }
            } else if (selectedClientId === 'multiple') {
              // Multiple clients tab: show only employees with multiple relationships
              employeesToShow = filteredEmployees.filter(emp => 
                emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1
              );
              console.log(`🔍 Multiple clients tab: ${employeesToShow.length} employees`);
              console.log(`🔍 Multiple clients names:`, employeesToShow.map(emp => emp.name));
            }
            
            return employeesToShow.map((emp) => (
            <Paper
              key={emp.id}
              sx={{ p: 2, mt: 2, display: "flex", flexDirection: "column" }}
              elevation={2}
            >
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!selectedEmployees[emp.id]}
                    onChange={() => toggleEmployee(emp.id)}
                  />
                }
                label={
                  <Typography variant="subtitle1" fontWeight="bold">
                    {emp.name}
                  </Typography>
                }
              />

              {selectedEmployees[emp.id] && (
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 2,
                    mt: 1,
                  }}
                >
                  {/* Client-Pay Type Relationship Selector - Only show on Multiple Clients tab */}
                  {selectedClientId === 'multiple' && emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 0 && (
                    <FormControl sx={{ width: 400 }}>
                      <InputLabel>Client-Pay Type Relationships</InputLabel>
                      <Select
                        multiple
                        value={inputs[emp.id]?.selectedRelationshipIds || []}
                        onChange={(e) => {
                          const relationshipIds = e.target.value as string[];
                          handleInputChange(emp.id, "selectedRelationshipIds", relationshipIds);
                          
                          // Auto-select all pay types from selected relationships
                          const selectedRelationships = emp.clientPayTypeRelationships?.filter(r => 
                            relationshipIds.includes(r.id)
                          ) || [];
                          const payTypes = selectedRelationships.map(r => r.payType);
                          handleInputChange(emp.id, "paymentMethods", payTypes);
                        }}
                        label="Client-Pay Type Relationships"
                        renderValue={(selected) => (selected as string[]).map(id => {
                          const relationship = emp.clientPayTypeRelationships?.find(r => r.id === id);
                          return relationship ? `${relationship.clientName} - ${relationship.payType === 'hourly' ? 'Hourly' : 'Per Diem'}` : id;
                        }).join(', ')}
                        MenuProps={{
                          PaperProps: {
                            style: {
                              maxHeight: 300
                            }
                          }
                        }}
                      >
                        {emp.clientPayTypeRelationships
                          .filter(rel => rel.active)
                          .map((relationship) => (
                            <MenuItem key={relationship.id} value={relationship.id}>
                              <Checkbox checked={(inputs[emp.id]?.selectedRelationshipIds || []).indexOf(relationship.id) > -1} />
                              <ListItemText primary={`${relationship.clientName} - ${relationship.payType === 'hourly' ? 'Hourly' : 'Per Diem'}`} />
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                  )}
                  

                  

                  
                  {/* Dynamic Payment Sections Based on Selected Relationships */}
                  {selectedClientId === 'multiple' && inputs[emp.id]?.selectedRelationshipIds && (inputs[emp.id]?.selectedRelationshipIds?.length || 0) > 0 && (
                    <>
                      {/* Get selected relationships */}
                  {(() => {
                        const selectedRelationships = emp.clientPayTypeRelationships
                          ?.filter((rel: any) => inputs[emp.id]?.selectedRelationshipIds?.includes(rel.id)) || [];
                        
                        return selectedRelationships.map((relationship: any, index: number) => {
                          const isHourly = relationship.payType === 'hourly';
                          const isPerDiem = relationship.payType === 'perdiem';
                          
                      return (
                            <Box
                              key={relationship.id}
                              sx={{
                                p: 1.5,
                                mb: 1.5,
                                backgroundColor: isHourly ? '#f0f8ff' : '#fff3e0',
                                borderRadius: 1,
                                border: `1px solid ${isHourly ? '#b3d9ff' : '#ffcc80'}`,
                                width: '100%',
                                position: 'relative'
                              }}
                            >
                              {/* Client Header */}
                              <Box sx={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                mb: 1,
                                p: 0.5,
                                backgroundColor: isHourly ? '#e3f2fd' : '#fff8e1',
                                borderRadius: 0.5
                              }}>
                                <Typography variant="subtitle2" fontWeight="bold" sx={{ 
                                  color: isHourly ? '#1976d2' : '#f57c00',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.5
                                }}>
                                  {relationship.clientName} - {relationship.payType === 'hourly' ? 'Hourly' : 'Per Diem'}
                                </Typography>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  onClick={() => {
                                    // Remove this relationship from selection
                                    const currentIds = inputs[emp.id]?.selectedRelationshipIds || [];
                                    const newIds = currentIds.filter(id => id !== relationship.id);
                                    handleInputChange(emp.id, "selectedRelationshipIds", newIds);
                                  }}
                                  sx={{ minWidth: 'auto', p: 0.5 }}
                                >
                                  ✕
                                </Button>
                              </Box>

                              {/* Hourly Payment Fields */}
                              {isHourly && (
                                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                                  <TextField
                                    label="Hours"
                                    type="number"
                                    value={(inputs[emp.id] as any)?.[`${relationship.id}_hours`] || ""}
                                    onChange={(e) =>
                                      (handleInputChange as any)(emp.id, `${relationship.id}_hours`, e.target.value)
                                    }
                                    sx={{ width: 140 }}
                                    size="small"
                                  />
                                  <TextField
                                    label="OT Hours"
                                    type="number"
                                    value={(inputs[emp.id] as any)?.[`${relationship.id}_otHours`] || ""}
                                    onChange={(e) =>
                                      (handleInputChange as any)(emp.id, `${relationship.id}_otHours`, e.target.value)
                                    }
                                    sx={{ width: 140 }}
                                    size="small"
                                  />
                                  <TextField
                                    label="Holiday Hours"
                                    type="number"
                                    value={(inputs[emp.id] as any)?.[`${relationship.id}_holidayHours`] || ""}
                                    onChange={(e) =>
                                      (handleInputChange as any)(emp.id, `${relationship.id}_holidayHours`, e.target.value)
                                    }
                                    sx={{ width: 140 }}
                                    size="small"
                                  />
                                </Box>
                              )}

                              {/* Per Diem Payment Fields */}
                              {isPerDiem && (
                                <>
                                  {/* Per Diem Type Selection */}
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                                    <Typography variant="body2" color="#f57c00">
                                      Payment Type:
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button
                                        size="small"
                                        variant={(inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? "outlined" : "contained"}
                                        onClick={() => (handleInputChange as any)(emp.id, `${relationship.id}_perdiemBreakdown`, false)}
                                        sx={{ 
                                          backgroundColor: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? 'transparent' : '#f57c00',
                                          color: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? '#f57c00' : 'white',
                                          borderColor: '#f57c00',
                                          '&:hover': {
                                            backgroundColor: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? 'transparent' : '#e65100',
                                          }
                                        }}
                                      >
                                        Full Amount
                                      </Button>
                                      <Button
                                        size="small"
                                        variant={(inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? "contained" : "outlined"}
                                        onClick={() => (handleInputChange as any)(emp.id, `${relationship.id}_perdiemBreakdown`, true)}
                                        sx={{ 
                                          backgroundColor: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? '#f57c00' : 'transparent',
                                          color: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? 'white' : '#f57c00',
                                          borderColor: '#f57c00',
                                          '&:hover': {
                                            backgroundColor: (inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? '#e65100' : 'transparent',
                                          }
                                        }}
                                      >
                                        Breakdown
                                      </Button>
                                    </Box>
                                  </Box>
                                  
                                  {/* Conditional Per Diem Input Fields */}
                                  {!(inputs[emp.id] as any)?.[`${relationship.id}_perdiemBreakdown`] ? (
                                    // FULL AMOUNT mode - show only Amount field
                                  <TextField
                                    label="Amount"
                                    type="number"
                                    value={(inputs[emp.id] as any)?.[`${relationship.id}_perdiemAmount`] || ""}
                                    onChange={(e) =>
                                      (handleInputChange as any)(emp.id, `${relationship.id}_perdiemAmount`, e.target.value)
                                    }
                                    sx={{ width: 140, mb: 1 }}
                                    size="small"
                                  />
                                  ) : (
                                    // BREAKDOWN mode - show daily fields
                                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                                      <TextField
                                        key={day}
                                        label={day}
                                        type="number"
                                        value={(inputs[emp.id] as any)?.[`${relationship.id}_perdiem${day}`] || ""}
                                        onChange={(e) =>
                                          (handleInputChange as any)(emp.id, `${relationship.id}_perdiem${day}`, e.target.value)
                                        }
                                        sx={{ width: 120 }}
                                        size="small"
                                      />
                                    ))}
                                  </Box>
                                  )}
                                </>
                              )}

                              {/* Calculation Breakdown */}
                              {/* Calculation Breakdown - Above Total */}
                              <Box sx={{ 
                                mb: 0.5, 
                                p: 0.75, 
                                backgroundColor: isHourly ? '#e3f2fd' : '#fff8e1',
                                borderRadius: 1,
                                fontSize: '0.7rem',
                                textAlign: 'center',
                                color: isHourly ? '#1976d2' : '#f57c00'
                              }}>
                                {isHourly ? (
                                  // Hourly breakdown
                                  (() => {
                                    const hours = parseFloat((inputs[emp.id] as any)?.[`${relationship.id}_hours`] || '0');
                                    const otHours = parseFloat((inputs[emp.id] as any)?.[`${relationship.id}_otHours`] || '0');
                                    const holidayHours = parseFloat((inputs[emp.id] as any)?.[`${relationship.id}_holidayHours`] || '0');
                                    const rate = getRelationshipPayRate(emp, relationship.id);
                                    const breakdown = [];
                                    
                                    if (hours > 0) breakdown.push(`${hours}hrs × $${rate} = $${(hours * rate).toFixed(2)}`);
                                    if (otHours > 0) breakdown.push(`${otHours}OT × $${(rate * 1.5).toFixed(2)} = $${(otHours * rate * 1.5).toFixed(2)}`);
                                    if (holidayHours > 0) breakdown.push(`${holidayHours}holiday × $${(rate * 2).toFixed(2)} = $${(holidayHours * rate * 2).toFixed(2)}`);
                                    
                                    return breakdown.length > 0 ? breakdown.join(' + ') : 'No hours entered';
                                  })()
                                ) : (
                                  // Per diem breakdown
                                  (() => {
                                    // Check if any daily amounts are entered
                                    const dailyTotals: number[] = [];
                                    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(day => {
                                      const dayValue = parseFloat((inputs[emp.id] as any)[`${relationship.id}_perdiem${day}`] || '0');
                                      if (dayValue > 0) dailyTotals.push(dayValue);
                                    });
                                    
                                    if (dailyTotals.length > 0) {
                                      // Daily breakdown mode - use daily amounts
                                      const total = dailyTotals.reduce((sum, val) => sum + val, 0);
                                      return `$${total.toFixed(2)} (${dailyTotals.length} days)`;
                                    } else {
                                      // Full amount mode - use single amount
                                      const amount = parseFloat((inputs[emp.id] as any)[`${relationship.id}_perdiemAmount`] || '0');
                                      return amount > 0 ? `$${amount.toFixed(2)}` : 'No amount entered';
                                    }
                                  })()
                                )}
                              </Box>
                              
                              {/* Payment Total for this relationship */}
                              <Box sx={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                mt: 0.5, 
                                p: 0.75, 
                                backgroundColor: isHourly ? '#e3f2fd' : '#fff8e1', 
                                borderRadius: 1 
                              }}>
                                <Typography variant="body2" fontWeight="bold" sx={{ color: isHourly ? '#1976d2' : '#f57c00' }}>
                                  {isHourly ? 'Hourly' : 'Per Diem'} Total:
                                </Typography>
                                <Typography variant="body2" fontWeight="bold" sx={{ color: isHourly ? '#1976d2' : '#f57c00' }}>
                                  ${isHourly 
                                    ? calculateHourlyTotalForRelationship(emp, inputs[emp.id] || {}, relationship.id)
                                    : calculatePerDiemTotalForRelationship(inputs[emp.id] || {}, relationship.id)
                                  }
                                </Typography>
                              </Box>
                            </Box>
                          );
                        });
                  })()}
                    </>
                  )}

                  {/* Legacy Single Client Support - Keep for backward compatibility */}
                  {selectedClientId !== 'multiple' && (
                    <>
                      {/* Hourly Section - Show on hourly clients */}
                      {selectedClientId && !companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('per diem') && (
                    <Box sx={{ 
                      p: 1.5, 
                      mb: 1.5, 
                      backgroundColor: '#f0f8ff', 
                      borderRadius: 1, 
                      border: '1px solid #b3d9ff',
                      width: '100%'
                    }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5, color: '#1976d2' }}>
                        Hourly Payment
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                  <TextField
                    label="Hours"
                    type="number"
                    value={(() => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          return inputs[emp.id]?.[`${relationship.id}_hours`] || "";
                        }
                      }
                      return inputs[emp.id]?.hours || "";
                    })()}
                    onChange={(e) => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          handleInputChange(emp.id, `${relationship.id}_hours`, e.target.value);
                          return;
                        }
                      }
                      handleInputChange(emp.id, "hours", e.target.value);
                    }}
                    sx={{ width: 140 }}
                    size="small"
                  />
                  <TextField
                    label="OT Hours"
                    type="number"
                    value={(() => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          return inputs[emp.id]?.[`${relationship.id}_otHours`] || "";
                        }
                      }
                      return inputs[emp.id]?.otHours || "";
                    })()}
                    onChange={(e) => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          handleInputChange(emp.id, `${relationship.id}_otHours`, e.target.value);
                          return;
                        }
                      }
                      handleInputChange(emp.id, "otHours", e.target.value);
                    }}
                    sx={{ width: 140 }}
                    size="small"
                  />
                  <TextField
                    label="Holiday Hours"
                    type="number"
                    value={(() => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          return inputs[emp.id]?.[`${relationship.id}_holidayHours`] || "";
                        }
                      }
                      return inputs[emp.id]?.holidayHours || "";
                    })()}
                    onChange={(e) => {
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          handleInputChange(emp.id, `${relationship.id}_holidayHours`, e.target.value);
                          return;
                        }
                      }
                      handleInputChange(emp.id, "holidayHours", e.target.value);
                    }}
                    sx={{ width: 140 }}
                    size="small"
                  />
                      </Box>
                      {/* ✅ Hourly Total */}
                      {/* Calculation Breakdown - Above Total */}
                      <Box sx={{ 
                        mb: 0.5, 
                        p: 0.75, 
                        backgroundColor: '#e3f2fd',
                        borderRadius: 1,
                        fontSize: '0.7rem',
                        textAlign: 'center',
                        color: '#1976d2'
                      }}>
                        {(() => {
                          // If employee has relationships and we're on a single client tab, use relationship-specific data
                          if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                            const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                            if (relationship) {
                              const hours = parseFloat(inputs[emp.id]?.[`${relationship.id}_hours`] || '0');
                              const otHours = parseFloat(inputs[emp.id]?.[`${relationship.id}_otHours`] || '0');
                              const holidayHours = parseFloat(inputs[emp.id]?.[`${relationship.id}_holidayHours`] || '0');
                              const rate = relationship.payRate ? parseFloat(relationship.payRate) : (emp.payRate || 0);
                              const breakdown = [];
                              
                              if (hours > 0) breakdown.push(`${hours}hrs × $${rate} = $${(hours * rate).toFixed(2)}`);
                              if (otHours > 0) breakdown.push(`${otHours}OT × $${(rate * 1.5).toFixed(2)} = $${(otHours * rate * 1.5).toFixed(2)}`);
                              if (holidayHours > 0) breakdown.push(`${holidayHours}holiday × $${(rate * 2).toFixed(2)} = $${(holidayHours * rate * 2).toFixed(2)}`);
                              
                              return breakdown.length > 0 ? breakdown.join(' + ') : 'No hours entered';
                            }
                          }
                          
                          // Fallback to legacy fields
                          const hours = parseFloat(inputs[emp.id]?.hours || '0');
                          const otHours = parseFloat(inputs[emp.id]?.otHours || '0');
                          const holidayHours = parseFloat(inputs[emp.id]?.holidayHours || '0');
                          const rate = emp.payRate || 0;
                          const breakdown = [];
                          
                          if (hours > 0) breakdown.push(`${hours}hrs × $${rate} = $${(hours * rate).toFixed(2)}`);
                          if (otHours > 0) breakdown.push(`${otHours}OT × $${(rate * 1.5).toFixed(2)} = $${(otHours * rate * 1.5).toFixed(2)}`);
                          if (holidayHours > 0) breakdown.push(`${holidayHours}holiday × $${(rate * 2).toFixed(2)} = $${(holidayHours * rate * 2).toFixed(2)}`);
                          
                          return breakdown.length > 0 ? breakdown.join(' + ') : 'No hours entered';
                        })()}
                      </Box>

                      {/* ✅ Hourly Total */}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, p: 0.75, backgroundColor: '#e3f2fd', borderRadius: 1 }}>
                        <Typography variant="body2" fontWeight="bold" color="#1976d2">
                          Hourly Total:
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="#1976d2">
                          ${calculateHourlyTotal(emp, inputs[emp.id] || {})}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  
                      {/* Per Diem Section - Show on per diem clients (but NOT in multiple clients tab) */}
                      {selectedClientId && selectedClientId !== 'multiple' && !companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('hourly') && (
                    <Box sx={{ 
                      p: 1.5, 
                      mb: 1.5, 
                      backgroundColor: '#fff3e0', 
                      borderRadius: 1, 
                      border: '1px solid #ffcc80',
                      width: '100%'
                    }}>
                      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5, color: '#f57c00' }}>
                        Per Diem Payment
                      </Typography>
                      
                      {/* Per Diem Type Selection */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                        <Typography variant="body2" color="#f57c00">
                          Payment Type:
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            variant={(() => {
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? "outlined" : "contained";
                                }
                              }
                              return inputs[emp.id]?.perdiemBreakdown ? "outlined" : "contained";
                            })()}
                            onClick={() => {
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, false);
                                  return;
                                }
                              }
                              handleInputChange(emp.id, "perdiemBreakdown", false);
                            }}
                            sx={{ 
                              backgroundColor: (() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? 'transparent' : '#f57c00';
                                  }
                                }
                                return inputs[emp.id]?.perdiemBreakdown ? 'transparent' : '#f57c00';
                              })(),
                              color: (() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? '#f57c00' : 'white';
                                  }
                                }
                                return inputs[emp.id]?.perdiemBreakdown ? '#f57c00' : 'white';
                              })(),
                              borderColor: '#f57c00',
                              '&:hover': {
                                backgroundColor: (() => {
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? 'transparent' : '#e65100';
                                    }
                                  }
                                  return inputs[emp.id]?.perdiemBreakdown ? 'transparent' : '#e65100';
                                })(),
                              }
                            }}
                          >
                            Full Amount
                          </Button>
                          <Button
                            size="small"
                            variant={(() => {
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? "contained" : "outlined";
                                }
                              }
                              return inputs[emp.id]?.perdiemBreakdown ? "contained" : "outlined";
                            })()}
                            onClick={() => {
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                  return;
                                }
                              }
                              handleInputChange(emp.id, "perdiemBreakdown", true);
                            }}
                            sx={{ 
                              backgroundColor: (() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? '#f57c00' : 'transparent';
                                  }
                                }
                                return inputs[emp.id]?.perdiemBreakdown ? '#f57c00' : 'transparent';
                              })(),
                              color: (() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? 'white' : '#f57c00';
                                  }
                                }
                                return inputs[emp.id]?.perdiemBreakdown ? 'white' : '#f57c00';
                              })(),
                              borderColor: '#f57c00',
                              '&:hover': {
                                backgroundColor: (() => {
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] ? '#e65100' : 'transparent';
                                    }
                                  }
                                  return inputs[emp.id]?.perdiemBreakdown ? '#e65100' : 'transparent';
                                })(),
                              }
                            }}
                          >
                            Breakdown
                          </Button>
                        </Box>
                      </Box>

                      {/* Full Amount Input */}
                      {!(() => {
                        if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                          const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                          if (relationship) {
                            return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`];
                          }
                        }
                        return inputs[emp.id]?.perdiemBreakdown;
                      })() && (
                  <TextField
                          label="Amount"
                          type="number"
                          value={(() => {
                            // If employee has relationships and we're on a single client tab, use relationship-specific field
                            if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                              const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                              if (relationship) {
                                return inputs[emp.id]?.[`${relationship.id}_perdiemAmount`] || "";
                              }
                            }
                            // Fallback to legacy field
                            return inputs[emp.id]?.perdiemAmount || "";
                          })()}
                          onChange={(e) => {
                            // If employee has relationships and we're on a single client tab, update relationship-specific field
                            if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                              const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                              if (relationship) {
                                handleInputChange(emp.id, `${relationship.id}_perdiemAmount`, e.target.value);
                                return;
                              }
                            }
                            // Fallback to legacy field
                            handleInputChange(emp.id, "perdiemAmount", e.target.value);
                          }}
                          sx={{ width: 250 }}
                          placeholder="Enter amount"
                          size="small"
                        />
                      )}

                      {/* Daily Breakdown */}
                      {(() => {
                        if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                          const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                          if (relationship) {
                            return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`];
                          }
                        }
                        return inputs[emp.id]?.perdiemBreakdown;
                      })() && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Typography variant="body2" fontWeight="bold" color="#f57c00" sx={{ mb: 0.5 }}>
                            Daily Breakdown:
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1 }}>
                            <TextField
                              label="Monday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemMonday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemMonday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemMonday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemMonday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Tuesday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemTuesday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemTuesday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemTuesday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemTuesday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Wednesday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemWednesday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemWednesday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemWednesday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemWednesday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Thursday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemThursday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemThursday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemThursday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemThursday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Friday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemFriday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemFriday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemFriday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemFriday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Saturday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemSaturday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemSaturday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemSaturday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemSaturday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                            <TextField
                              label="Sunday"
                              type="number"
                              value={(() => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return inputs[emp.id]?.[`${relationship.id}_perdiemSunday`] || "";
                                  }
                                }
                                return inputs[emp.id]?.perdiemSunday || "";
                              })()}
                              onChange={(e) => {
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    handleInputChange(emp.id, `${relationship.id}_perdiemSunday`, e.target.value);
                                    handleInputChange(emp.id, `${relationship.id}_perdiemBreakdown`, true);
                                    return;
                                  }
                                }
                                handleInputChange(emp.id, "perdiemSunday", e.target.value);
                                handleInputChange(emp.id, "perdiemBreakdown", true);
                              }}
                              size="small"
                              placeholder="0"
                            />
                          </Box>
                        </Box>
                      )}

                      {/* Calculation Breakdown - Above Total */}
                      <Box sx={{ 
                        mb: 0.5, 
                        p: 0.75, 
                        backgroundColor: '#fff8e1',
                        borderRadius: 1,
                        fontSize: '0.7rem',
                        textAlign: 'center',
                        color: '#f57c00'
                      }}>
                        {(() => {
                          // If employee has relationships and we're on a single client tab, use relationship-specific data
                          if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                            const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                            if (relationship) {
                              const perdiemBreakdown = inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`];
                              if (perdiemBreakdown) {
                                // Daily breakdown mode - calculate from relationship-specific daily fields
                                const dailyTotal = ['perdiemMonday', 'perdiemTuesday', 'perdiemWednesday', 
                                                   'perdiemThursday', 'perdiemFriday', 'perdiemSaturday', 'perdiemSunday']
                                  .reduce((sum, day) => sum + parseFloat(inputs[emp.id]?.[`${relationship.id}_${day}`] || '0'), 0);
                                return dailyTotal > 0 ? `$${dailyTotal.toFixed(2)} (daily breakdown)` : 'No daily amounts entered';
                              } else {
                                // Full amount mode - use relationship-specific amount
                                const amount = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemAmount`] || '0');
                                return amount > 0 ? `$${amount.toFixed(2)}` : 'No amount entered';
                              }
                            }
                          }
                          
                          // Fallback to legacy fields
                          if (inputs[emp.id]?.perdiemBreakdown) {
                            // Daily breakdown mode - just show total
                            const total = parseFloat(calculatePerDiemTotal(inputs[emp.id] || {}));
                            return total > 0 ? `$${total.toFixed(2)} (daily breakdown)` : 'No daily amounts entered';
                          } else {
                            // Full amount mode
                            const amount = parseFloat(inputs[emp.id]?.perdiemAmount || '0');
                            return amount > 0 ? `$${amount.toFixed(2)}` : 'No amount entered';
                          }
                        })()}
                      </Box>

                      {/* ✅ Per Diem Total */}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, p: 0.75, backgroundColor: '#fff8e1', borderRadius: 1 }}>
                        <Typography variant="body2" fontWeight="bold" color="#f57c00">
                          Per Diem Total:
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="#f57c00">
                          ${(() => {
                            // If employee has relationships and we're on a single client tab, use relationship-specific calculation
                            if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                              const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                              if (relationship) {
                                // For single client with relationship, calculate from relationship-specific fields
                                const perdiemBreakdown = inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`];
                                
                                // Debug logging
                                console.log(`🔍 DEBUG per diem total calculation for ${emp.name}:`, {
                                  relationshipId: relationship.id,
                                  perdiemBreakdown,
                                  monday: inputs[emp.id]?.[`${relationship.id}_perdiemMonday`],
                                  tuesday: inputs[emp.id]?.[`${relationship.id}_perdiemTuesday`],
                                  wednesday: inputs[emp.id]?.[`${relationship.id}_perdiemWednesday`],
                                  thursday: inputs[emp.id]?.[`${relationship.id}_perdiemThursday`],
                                  friday: inputs[emp.id]?.[`${relationship.id}_perdiemFriday`],
                                  saturday: inputs[emp.id]?.[`${relationship.id}_perdiemSaturday`],
                                  sunday: inputs[emp.id]?.[`${relationship.id}_perdiemSunday`]
                                });
                                
                                if (perdiemBreakdown) {
                                  // Calculate from daily breakdown
                                  const monday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemMonday`] || '0') || 0;
                                  const tuesday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemTuesday`] || '0') || 0;
                                  const wednesday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemWednesday`] || '0') || 0;
                                  const thursday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemThursday`] || '0') || 0;
                                  const friday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemFriday`] || '0') || 0;
                                  const saturday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemSaturday`] || '0') || 0;
                                  const sunday = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemSunday`] || '0') || 0;
                                  
                                  const total = monday + tuesday + wednesday + thursday + friday + saturday + sunday;
                                  console.log(`🔍 DEBUG calculated total: ${total}`);
                                  return total > 0 ? total.toFixed(2) : '0.00';
                                } else {
                                  // Use full amount
                                  const amount = parseFloat(inputs[emp.id]?.[`${relationship.id}_perdiemAmount`] || '0') || 0;
                                  console.log(`🔍 DEBUG using full amount: ${amount}`);
                                  return amount > 0 ? amount.toFixed(2) : '0.00';
                                }
                              }
                            }
                            // Fallback to legacy calculation
                            return calculatePerDiemTotal(inputs[emp.id] || {});
                          })()}
                        </Typography>
                      </Box>
                    </Box>
                      )}
                    </>
                  )}
                  <TextField
                    label="Memo (optional) - will show in middle section"
                    value={inputs[emp.id]?.memo || ""}
                    onChange={(e) =>
                      handleInputChange(emp.id, "memo", e.target.value)
                    }
                    sx={{ flex: 1, minWidth: 200 }}
                    placeholder="Enter memo (optional)"
                  />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Amount: $
                    </Typography>
                    <Typography variant="h6" color="primary">
                      {calculateAmount(emp, inputs[emp.id] || { hours: "", otHours: "", holidayHours: "", memo: "" })}
                    </Typography>
                  </Box>
                  
                  {/* Calculation Breakdown - Show based on client tab and actual data */}
                  {(() => {
                    // Show calculation breakdown if:
                    // 1. Multiple Clients tab (show for any data)
                    // 2. Americold Hourly tab (show for hourly data)
                    // 3. Americold Per Diem tab (show for per diem data)
                    const hasHourlyData = parseFloat(inputs[emp.id]?.hours || '0') > 0 || 
                                        parseFloat(inputs[emp.id]?.otHours || '0') > 0 || 
                                        parseFloat(inputs[emp.id]?.holidayHours || '0') > 0;
                    const hasPerDiemData = (() => {
                      // If employee has relationships and we're on a single client tab, use relationship-specific calculation
                      if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                        const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                        if (relationship) {
                          return parseFloat(calculatePerDiemTotalForRelationship(inputs[emp.id] || {}, relationship.id)) > 0;
                        }
                      }
                      // Fallback to legacy calculation
                      return parseFloat(calculatePerDiemTotal(inputs[emp.id] || {})) > 0;
                    })();
                    
                    if (selectedClientId === 'multiple') {
                      // Multiple clients: show for any data
                      return (hasHourlyData || hasPerDiemData) && selectedEmployees[emp.id];
                    } else if (selectedClientId && companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('hourly')) {
                      // Hourly client: show for hourly data only
                      return hasHourlyData && selectedEmployees[emp.id];
                    } else if (selectedClientId && companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('per diem')) {
                      // Per diem client: show for per diem data only
                      return hasPerDiemData && selectedEmployees[emp.id];
                    }
                    return false;
                  })() && (
                    <Box sx={{ 
                      mt: 1, 
                      p: 2, 
                      backgroundColor: '#f8f9fa', 
                      borderRadius: 1, 
                      border: '1px solid #e9ecef',
                      width: '100%'
                    }}>
                      <Typography variant="caption" fontWeight="bold" sx={{ mb: 1, color: '#495057', display: 'block' }}>
                        💰 Calculation Breakdown:
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: '0.75rem' }}>
                        {/* Hourly data - only show on hourly or multiple clients tabs */}
                        {(selectedClientId === 'multiple' || 
                          (selectedClientId && companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('hourly'))) && (
                          <>
                            {parseFloat(inputs[emp.id]?.hours || '0') > 0 && (
                              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Regular Hours ({inputs[emp.id]?.hours || '0'}h × ${getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly').toFixed(2)}):</span>
                                <span>${(parseFloat(inputs[emp.id]?.hours || '0') * getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly')).toFixed(2)}</span>
                              </Box>
                            )}
                            {parseFloat(inputs[emp.id]?.otHours || '0') > 0 && (
                              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>OT Hours ({inputs[emp.id]?.otHours || '0'}h × ${(getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly') * 1.5).toFixed(2)}):</span>
                                <span>${(parseFloat(inputs[emp.id]?.otHours || '0') * getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly') * 1.5).toFixed(2)}</span>
                              </Box>
                            )}
                            {parseFloat(inputs[emp.id]?.holidayHours || '0') > 0 && (
                              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Holiday Hours ({inputs[emp.id]?.holidayHours || '0'}h × ${(getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly') * 2).toFixed(2)}):</span>
                                <span>${(parseFloat(inputs[emp.id]?.holidayHours || '0') * getEffectivePayRate(emp, inputs[emp.id] || {}, 'hourly') * 2).toFixed(2)}</span>
                              </Box>
                            )}
                          </>
                        )}
                        {/* Per diem data - only show on per diem or multiple clients tabs */}
                        {(selectedClientId === 'multiple' || 
                          (selectedClientId && companyClients.find(c => c.id === selectedClientId)?.name.toLowerCase().includes('per diem'))) && (
                          <>
                            {(() => {
                              // If employee has relationships and we're on a single client tab, use relationship-specific calculation
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  const total = parseFloat(calculatePerDiemTotalForRelationship(inputs[emp.id] || {}, relationship.id));
                                  return total > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Per Diem Amount:</span>
                                      <span>${total.toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                }
                              }
                              // Fallback to legacy calculation
                              const total = parseFloat(calculatePerDiemTotal(inputs[emp.id] || {}));
                              return total > 0 ? (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span>Per Diem Amount:</span>
                                  <span>${total.toFixed(2)}</span>
                                </Box>
                              ) : null;
                            })()}
                            {/* ✅ Show daily breakdown if using breakdown mode */}
                            {(() => {
                              // If employee has relationships and we're on a single client tab, use relationship-specific fields
                              if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                if (relationship) {
                                  return inputs[emp.id]?.[`${relationship.id}_perdiemBreakdown`] && 
                                         parseFloat(calculatePerDiemTotalForRelationship(inputs[emp.id] || {}, relationship.id)) > 0;
                                }
                              }
                              // Fallback to legacy fields
                              return inputs[emp.id]?.perdiemBreakdown && 
                                     parseFloat(calculatePerDiemTotal(inputs[emp.id] || {})) > 0;
                            })() && (
                              <Box sx={{ ml: 2, mt: 0.5 }}>
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const monday = inputs[emp.id]?.[`${relationship.id}_perdiemMonday`];
                                      return monday && parseFloat(monday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Monday:</span>
                                          <span>${parseFloat(monday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const monday = inputs[emp.id]?.perdiemMonday;
                                  return monday && parseFloat(monday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Monday:</span>
                                      <span>${parseFloat(monday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const tuesday = inputs[emp.id]?.[`${relationship.id}_perdiemTuesday`];
                                      return tuesday && parseFloat(tuesday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Tuesday:</span>
                                          <span>${parseFloat(tuesday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const tuesday = inputs[emp.id]?.perdiemTuesday;
                                  return tuesday && parseFloat(tuesday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Tuesday:</span>
                                      <span>${parseFloat(tuesday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const wednesday = inputs[emp.id]?.[`${relationship.id}_perdiemWednesday`];
                                      return wednesday && parseFloat(wednesday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Wednesday:</span>
                                          <span>${parseFloat(wednesday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const wednesday = inputs[emp.id]?.perdiemWednesday;
                                  return wednesday && parseFloat(wednesday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Wednesday:</span>
                                      <span>${parseFloat(wednesday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const thursday = inputs[emp.id]?.[`${relationship.id}_perdiemThursday`];
                                      return thursday && parseFloat(thursday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Thursday:</span>
                                          <span>${parseFloat(thursday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const thursday = inputs[emp.id]?.perdiemThursday;
                                  return thursday && parseFloat(thursday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Thursday:</span>
                                      <span>${parseFloat(thursday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const friday = inputs[emp.id]?.[`${relationship.id}_perdiemFriday`];
                                      return friday && parseFloat(friday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Friday:</span>
                                          <span>${parseFloat(friday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const friday = inputs[emp.id]?.perdiemFriday;
                                  return friday && parseFloat(friday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Friday:</span>
                                      <span>${parseFloat(friday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const saturday = inputs[emp.id]?.[`${relationship.id}_perdiemSaturday`];
                                      return saturday && parseFloat(saturday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Saturday:</span>
                                          <span>${parseFloat(saturday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const saturday = inputs[emp.id]?.perdiemSaturday;
                                  return saturday && parseFloat(saturday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Saturday:</span>
                                      <span>${parseFloat(saturday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                                {(() => {
                                  // If employee has relationships and we're on a single client tab, use relationship-specific fields
                                  if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                    const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                    if (relationship) {
                                      const sunday = inputs[emp.id]?.[`${relationship.id}_perdiemSunday`];
                                      return sunday && parseFloat(sunday) > 0 ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                          <span>• Sunday:</span>
                                          <span>${parseFloat(sunday).toFixed(2)}</span>
                                        </Box>
                                      ) : null;
                                    }
                                  }
                                  // Fallback to legacy fields
                                  const sunday = inputs[emp.id]?.perdiemSunday;
                                  return sunday && parseFloat(sunday) > 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}>
                                      <span>• Sunday:</span>
                                      <span>${parseFloat(sunday).toFixed(2)}</span>
                                    </Box>
                                  ) : null;
                                })()}
                              </Box>
                            )}
                          </>
                        )}
                        <Divider sx={{ my: 0.5 }} />
                        {/* ✅ Show individual totals if both payment methods are used (only on multiple clients tab) */}
                        {selectedClientId === 'multiple' && 
                         parseFloat(inputs[emp.id]?.hours || '0') > 0 && 
                         parseFloat(calculatePerDiemTotal(inputs[emp.id] || {})) > 0 && (
                          <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1976d2' }}>
                              <span>Hourly Total:</span>
                              <span>${calculateHourlyTotal(emp, inputs[emp.id] || {})}</span>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#f57c00' }}>
                              <span>Per Diem Total:</span>
                              <span>${(() => {
                                // If employee has relationships and we're on a single client tab, use relationship-specific calculation
                                if (emp.clientPayTypeRelationships && selectedClientId !== 'multiple') {
                                  const relationship = emp.clientPayTypeRelationships.find(rel => rel.clientId === selectedClientId);
                                  if (relationship) {
                                    return calculatePerDiemTotalForRelationship(inputs[emp.id] || {}, relationship.id);
                                  }
                                }
                                // Fallback to legacy calculation
                                return calculatePerDiemTotal(inputs[emp.id] || {});
                              })()}</span>
                            </Box>
                            <Divider sx={{ my: 0.5 }} />
                          </>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#1976d2' }}>
                          <span>Total Amount:</span>
                          <span>${calculateAmount(emp, inputs[emp.id] || {})}</span>
                        </Box>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </Paper>
          ));
          })()}

          {/* Show Create Checks button only if there are employees to show */}
          {(() => {
            let employeesToShow = filteredEmployees;
            
            // Debug: Log employee data for key employees
            const domingo = filteredEmployees.find(emp => emp.name === 'Domingo Perez Lopez');
            if (domingo) {
              console.log('🔍 Domingo Perez Lopez data:', {
                id: domingo.id,
                name: domingo.name,
                clientId: domingo.clientId,
                payType: domingo.payType,
                clientPayTypeRelationships: domingo.clientPayTypeRelationships
              });
            }
            
            if (selectedClientId && selectedClientId !== 'multiple') {
              // Single client tab: show employees for this specific client
              const client = companyClients.find(c => c.id === selectedClientId);
              if (client) {
                console.log(`🔍 Filtering for client: ${client.name} (${client.id})`);
                console.log(`🔍 Total employees before filtering: ${filteredEmployees.length}`);
                
                if (client.name.toLowerCase().includes('per diem')) {
                  // Per Diem tab: show employees with per diem relationships for this client
                  employeesToShow = filteredEmployees.filter(emp => {
                    // Check if employee has relationships with this client and per diem pay type
                    const hasPerDiemForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                      rel.clientId === selectedClientId && rel.payType === 'perdiem'
                    );
                    // Check legacy fields
                    const hasLegacyPerDiem = emp.clientId === selectedClientId && emp.payType === 'perdiem';
                    // Check if employee has multiple relationships (should go to multiple tab)
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    
                    const shouldShow = (hasPerDiemForThisClient || hasLegacyPerDiem) && !hasMultiple;
                    if (emp.name === 'Domingo Perez Lopez') {
                      console.log(`🔍 Domingo: hasPerDiemForThisClient=${hasPerDiemForThisClient}, hasLegacyPerDiem=${hasLegacyPerDiem}, hasMultiple=${hasMultiple}, shouldShow=${shouldShow}`);
                    }
                    return shouldShow;
                  });
                } else if (client.name.toLowerCase().includes('hourly')) {
                  // Hourly tab: show employees with hourly relationships for this client
                  employeesToShow = filteredEmployees.filter(emp => {
                    // Check if employee has relationships with this client and hourly pay type
                    const hasHourlyForThisClient = emp.clientPayTypeRelationships?.some(rel => 
                      rel.clientId === selectedClientId && rel.payType === 'hourly'
                    );
                    // Check legacy fields
                    const hasLegacyHourly = emp.clientId === selectedClientId && emp.payType === 'hourly';
                    // Check if employee has multiple relationships (should go to multiple tab)
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    
                    const shouldShow = (hasHourlyForThisClient || hasLegacyHourly) && !hasMultiple;
                    if (emp.name === 'Domingo Perez Lopez') {
                      console.log(`🔍 Domingo: hasHourlyForThisClient=${hasHourlyForThisClient}, hasLegacyHourly=${hasLegacyHourly}, hasMultiple=${hasMultiple}, shouldShow=${shouldShow}`);
                    }
                    return shouldShow;
                  });
                } else {
                  // Other client tabs: show employees for this specific client (but not multiple)
                  employeesToShow = filteredEmployees.filter(emp => {
                    const hasThisClient = emp.clientPayTypeRelationships?.some(rel => rel.clientId === selectedClientId) ||
                                        emp.clientId === selectedClientId;
                    const hasMultiple = emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1;
                    return hasThisClient && !hasMultiple;
                  });
                }
                
                console.log(`🔍 Employees after filtering: ${employeesToShow.length}`);
                console.log(`🔍 Employee names:`, employeesToShow.map(emp => emp.name));
              }
            } else if (selectedClientId === 'multiple') {
              // Multiple clients tab: show only employees with multiple relationships
              employeesToShow = filteredEmployees.filter(emp => 
                emp.clientPayTypeRelationships && emp.clientPayTypeRelationships.length > 1
              );
              console.log(`🔍 Multiple clients tab: ${employeesToShow.length} employees`);
              console.log(`🔍 Multiple clients names:`, employeesToShow.map(emp => emp.name));
            }
            
            return employeesToShow.length > 0 ? (
            <Button
              variant="contained"
              size="large"
              onClick={reviewChecks}
              disabled={isCreatingChecks}
              sx={{ mt: 3 }}
            >
              {isCreatingChecks ? "Creating Checks..." : "Review Checks"}
            </Button>
            ) : null;
          })()}
        </>
      )}

      <Snackbar
        open={showSuccessMessage}
        autoHideDuration={4000}
        onClose={() => setShowSuccessMessage(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert 
          onClose={() => setShowSuccessMessage(false)} 
          severity="success"
          sx={{ 
            minWidth: '300px',
            fontSize: '14px',
            '& .MuiAlert-message': {
              display: 'flex',
              alignItems: 'center'
            }
          }}
        >
          ✅ {successMessageText}
        </Alert>
      </Snackbar>

      {/* Floating Review Panel */}
      {showReviewPanel && (
        <Box
          sx={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '90vw',
            maxWidth: '800px',
            maxHeight: '80vh',
            bgcolor: 'background.paper',
            borderRadius: 2,
            boxShadow: 24,
            p: 3,
            zIndex: 1300,
            overflow: 'auto'
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" fontWeight="bold">
              📋 Review Checks Before Creating
            </Typography>
            <Button
              onClick={() => setShowReviewPanel(false)}
              sx={{ minWidth: 'auto' }}
            >
              ✕
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Please review the following checks before creating them. You can go back to make changes if needed.
          </Typography>

          {/* Review List */}
          <Box sx={{ mb: 3 }}>
            {reviewData.map((item, index) => (
              <Paper key={index} sx={{ p: 2, mb: 2, border: '1px solid #e0e0e0' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="h6" fontWeight="bold">
                    {item.employee.name}
                  </Typography>
                  <Typography variant="h6" color="primary" fontWeight="bold">
                    ${item.calculatedAmount.toFixed(2)}
                  </Typography>
                </Box>

                {/* Client Info */}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {selectedClientId === 'multiple' ? 'Multiple Clients' : 
                   companyClients.find(c => c.id === selectedClientId)?.name || 'Unknown Client'}
                </Typography>

                                {/* Calculation Breakdown */}
                <Box sx={{ 
                  mb: 1, 
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #e9ecef',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '0.75rem'
                }}>
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    fontWeight: 'bold',
                    display: 'block',
                    mb: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Calculation Breakdown
                  </Typography>
                  
                  {(() => {
                    const breakdownItems: Array<{label: string, value: string, type: 'hourly' | 'perdiem' | 'total'}> = [];
                    
                    // Check if this is multiple clients with relationships
                    if (item.input.selectedRelationshipIds && item.input.selectedRelationshipIds.length > 0) {
                      // Multiple clients mode - use relationship-specific data
                      item.input.selectedRelationshipIds.forEach((relationshipId: string) => {
                        const relationship = item.employee.clientPayTypeRelationships?.find((rel: any) => rel.id === relationshipId);
                        if (relationship) {
                          if (relationship.payType === 'hourly') {
                            const hours = parseFloat((item.input as any)[`${relationshipId}_hours`] || '0');
                            const otHours = parseFloat((item.input as any)[`${relationshipId}_otHours`] || '0');
                            const holidayHours = parseFloat((item.input as any)[`${relationshipId}_holidayHours`] || '0');
                            const rate = getRelationshipPayRate(item.employee, relationshipId);
                            
                            if (hours > 0) breakdownItems.push({
                              label: `${relationship.clientName} - Regular Hours`,
                              value: `${hours}hrs × $${rate} = $${(hours * rate).toFixed(2)}`,
                              type: 'hourly'
                            });
                            if (otHours > 0) breakdownItems.push({
                              label: `${relationship.clientName} - Overtime`,
                              value: `${otHours}hrs × $${(rate * 1.5).toFixed(2)} = $${(otHours * rate * 1.5).toFixed(2)}`,
                              type: 'hourly'
                            });
                            if (holidayHours > 0) breakdownItems.push({
                              label: `${relationship.clientName} - Holiday`,
                              value: `${holidayHours}hrs × $${(rate * 2).toFixed(2)} = $${(holidayHours * rate * 2).toFixed(2)}`,
                              type: 'hourly'
                            });
                          } else if (relationship.payType === 'perdiem') {
                            const perdiemBreakdown = (item.input as any)[`${relationshipId}_perdiemBreakdown`];
                            if (perdiemBreakdown) {
                              // Daily breakdown mode
                              const dailyTotals: number[] = [];
                              ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(day => {
                                const dayValue = parseFloat((item.input as any)[`${relationshipId}_perdiem${day}`] || '0');
                                if (dayValue > 0) dailyTotals.push(dayValue);
                              });
                              if (dailyTotals.length > 0) {
                                const total = dailyTotals.reduce((sum, val) => sum + val, 0);
                                breakdownItems.push({
                                  label: `${relationship.clientName} - Daily Breakdown`,
                                  value: `$${total.toFixed(2)} (${dailyTotals.length} days)`,
                                  type: 'perdiem'
                                });
                              }
                            } else {
                              // Full amount mode
                              const amount = parseFloat((item.input as any)[`${relationshipId}_perdiemAmount`] || '0');
                              if (amount > 0) breakdownItems.push({
                                label: `${relationship.clientName} - Per Diem`,
                                value: `$${amount.toFixed(2)}`,
                                type: 'perdiem'
                              });
                            }
                          }
                        }
                      });
                    } else {
                      // Single client mode - use legacy fields
                      if (item.input.hours && parseFloat(item.input.hours) > 0) {
                        const hours = parseFloat(item.input.hours);
                        const rate = item.employee.payRate || 0;
                        breakdownItems.push({
                          label: 'Regular Hours',
                          value: `${hours}hrs × $${rate} = $${(hours * rate).toFixed(2)}`,
                          type: 'hourly'
                        });
                      }
                      if (item.input.otHours && parseFloat(item.input.otHours) > 0) {
                        const otHours = parseFloat(item.input.otHours);
                        const rate = item.employee.payRate || 0;
                        breakdownItems.push({
                          label: 'Overtime Hours',
                          value: `${otHours}hrs × $${(rate * 1.5).toFixed(2)} = $${(otHours * rate * 1.5).toFixed(2)}`,
                          type: 'hourly'
                        });
                      }
                      if (item.input.holidayHours && parseFloat(item.input.holidayHours) > 0) {
                        const holidayHours = parseFloat(item.input.holidayHours);
                        const rate = item.employee.payRate || 0;
                        breakdownItems.push({
                          label: 'Holiday Hours',
                          value: `${holidayHours}hrs × $${(rate * 2).toFixed(2)} = $${(holidayHours * rate * 2).toFixed(2)}`,
                          type: 'hourly'
                        });
                      }
                      
                      if (item.input.perdiemAmount && parseFloat(item.input.perdiemAmount) > 0 && !item.input.perdiemBreakdown) {
                        breakdownItems.push({
                          label: 'Per Diem',
                          value: `$${parseFloat(item.input.perdiemAmount).toFixed(2)}`,
                          type: 'perdiem'
                        });
                      }
                      if (item.input.perdiemBreakdown) {
                        const dailyTotals: number[] = [];
                        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(day => {
                          const dayKey = `perdiem${day}` as keyof typeof item.input;
                          if (item.input[dayKey] && parseFloat(item.input[dayKey] as string) > 0) {
                            dailyTotals.push(parseFloat(item.input[dayKey] as string));
                          }
                        });
                        if (dailyTotals.length > 0) {
                          const total = dailyTotals.reduce((sum, val) => sum + val, 0);
                          breakdownItems.push({
                            label: 'Daily Breakdown',
                            value: `$${total.toFixed(2)} (${dailyTotals.length} days)`,
                            type: 'perdiem'
                          });
                        }
                      }
                    }
                    
                    // Add total line
                    breakdownItems.push({
                      label: 'TOTAL',
                      value: `$${item.calculatedAmount.toFixed(2)}`,
                      type: 'total'
                    });
                    
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {breakdownItems.map((item, index) => (
                          <Box key={index} sx={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            padding: item.type === 'total' ? '8px 0' : '4px 0',
                            borderTop: item.type === 'total' ? '1px solid #dee2e6' : 'none',
                            fontWeight: item.type === 'total' ? 'bold' : 'normal',
                            color: item.type === 'total' ? 'primary.main' : 'text.secondary'
                          }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Box sx={{ 
                                width: '8px', 
                                height: '8px', 
                                borderRadius: '50%',
                                backgroundColor: item.type === 'hourly' ? '#1976d2' : 
                                               item.type === 'perdiem' ? '#f57c00' : '#4caf50'
                              }} />
                              <Typography variant="caption" sx={{ 
                                fontWeight: item.type === 'total' ? 'bold' : 'medium',
                                color: item.type === 'total' ? 'primary.main' : 'text.secondary'
                              }}>
                                {item.label}
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ 
                              fontFamily: 'monospace',
                              fontWeight: item.type === 'total' ? 'bold' : 'medium',
                              color: item.type === 'total' ? 'primary.main' : 'text.secondary'
                            }}>
                              {item.value}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    );
                  })()}
                </Box>

                {/* Breakdown */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: '0.875rem' }}>
                  {item.hourlyTotal > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Hourly Total:</span>
                      <span>${item.hourlyTotal.toFixed(2)}</span>
                    </Box>
                  )}
                  {item.perDiemTotal > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Per Diem Total:</span>
                      <span>${item.perDiemTotal.toFixed(2)}</span>
                    </Box>
                  )}
                  
                  {/* Show individual fields if they have values */}
                  {item.input.hours && parseFloat(item.input.hours) > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                      <span>• Hours: {item.input.hours}</span>
                      <span>${(parseFloat(item.input.hours) * (item.employee.payRate || 0)).toFixed(2)}</span>
                    </Box>
                  )}
                  {item.input.otHours && parseFloat(item.input.otHours) > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                      <span>• OT Hours: {item.input.otHours}</span>
                      <span>${(parseFloat(item.input.otHours) * (item.employee.payRate || 0) * 1.5).toFixed(2)}</span>
                    </Box>
                  )}
                  {item.input.holidayHours && parseFloat(item.input.holidayHours) > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                      <span>• Holiday Hours: {item.input.holidayHours}</span>
                      <span>${(parseFloat(item.input.holidayHours) * (item.employee.payRate || 0) * 2).toFixed(2)}</span>
                    </Box>
                  )}
                  
                  {/* Per diem breakdown */}
                  {item.input.perdiemBreakdown && (
                    <>
                      {item.input.perdiemMonday && parseFloat(item.input.perdiemMonday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Monday: ${parseFloat(item.input.perdiemMonday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemTuesday && parseFloat(item.input.perdiemTuesday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Tuesday: ${parseFloat(item.input.perdiemTuesday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemWednesday && parseFloat(item.input.perdiemWednesday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Wednesday: ${parseFloat(item.input.perdiemWednesday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemThursday && parseFloat(item.input.perdiemThursday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Thursday: ${parseFloat(item.input.perdiemThursday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemFriday && parseFloat(item.input.perdiemFriday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Friday: ${parseFloat(item.input.perdiemFriday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemSaturday && parseFloat(item.input.perdiemSaturday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Saturday: ${parseFloat(item.input.perdiemSaturday).toFixed(2)}</span>
                        </Box>
                      )}
                      {item.input.perdiemSunday && parseFloat(item.input.perdiemSunday) > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: 2 }}>
                          <span>• Sunday: ${parseFloat(item.input.perdiemSunday).toFixed(2)}</span>
                        </Box>
          )}
        </>
                  )}
                  
                  {item.input.memo && (
                    <Box sx={{ mt: 1, p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                      <Typography variant="body2" fontStyle="italic">
                        Memo: {item.input.memo}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            ))}
          </Box>

          {/* Total Amount */}
          <Box sx={{ p: 2, bgcolor: '#e3f2fd', borderRadius: 1, mb: 3 }}>
            <Typography variant="h6" fontWeight="bold" textAlign="center">
              Total Amount: ${reviewData.reduce((sum, item) => sum + item.calculatedAmount, 0).toFixed(2)}
            </Typography>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant="outlined"
              onClick={() => setShowReviewPanel(false)}
              size="large"
            >
              ← Go Back & Edit
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setShowReviewPanel(false);
                handleCreateChecks();
              }}
              disabled={isCreatingChecks}
              size="large"
                              startIcon={<span></span>}
            >
              {isCreatingChecks ? "Creating Checks..." : "Create Checks"}
            </Button>
          </Box>
        </Box>
      )}
      
      {/* Floating Navigation Menu - Centered with Backdrop */}
      <Fade in={floatingMenu.open} timeout={500}>
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            // Close when clicking on backdrop
            if (e.target === e.currentTarget) {
              setFloatingMenu(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <Box>
          <Paper
            elevation={12}
            sx={{
              p: 3,
              minWidth: 350,
              maxWidth: 400,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              borderRadius: 3,
              textAlign: 'center',
            }}
          >
            <Typography variant="h5" sx={{ mb: 1, fontWeight: 'bold' }}>
              ✅ Checks Created Successfully!
            </Typography>
            
            <Typography variant="body1" sx={{ mb: 3, opacity: 0.9 }}>
              Your checks have been created for <strong>{floatingMenu.companyName}</strong>
              {floatingMenu.clientName !== 'Multiple Clients' && (
                <> - <strong>{floatingMenu.clientName}</strong></>
              )}
            </Typography>
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={() => {
                  // Navigate to View Checks with company filter and current week
                  onGoToSection('View Checks');
                  // Set company filter
                  localStorage.setItem('pendingCompanyFilter', floatingMenu.companyId || '');
                  // Set current week filter to show recent checks automatically
                  const today = new Date();
                  const currentWeekKey = new Date(today.setDate(today.getDate() - today.getDay())).toISOString().slice(0, 10);
                  localStorage.setItem('pendingWeekFilter', currentWeekKey);
                  setFloatingMenu(prev => ({ ...prev, open: false }));
                }}
                sx={{
                  background: 'rgba(255,255,255,0.2)',
                  '&:hover': { background: 'rgba(255,255,255,0.3)' },
                  py: 1.5,
                  fontSize: '1.1rem'
                }}
              >
                📊 VIEW MY CHECKS
              </Button>
              
              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={() => {
                  // Reset to company selection
                  setSelectedCompanyId(null);
                  setSelectedClientId('multiple');
                  // Clear all tab data
                  setTabData({});
                  setFloatingMenu(prev => ({ ...prev, open: false }));
                }}
                sx={{
                  background: 'rgba(255,255,255,0.15)',
                  '&:hover': { background: 'rgba(255,255,255,0.25)' },
                  py: 1.5,
                  fontSize: '1.1rem'
                }}
              >
                🏢 CREATE CHECKS FOR NEW COMPANY
              </Button>
              
              <Button
                variant="text"
                size="medium"
                fullWidth
                onClick={() => setFloatingMenu(prev => ({ ...prev, open: false }))}
                sx={{
                  color: 'rgba(255,255,255,0.8)',
                  '&:hover': { 
                    color: 'white',
                    background: 'rgba(255,255,255,0.1)'
                  },
                  mt: 1
                }}
              >
                ✕ Close
              </Button>
            </Box>
          </Paper>
          </Box>
        </Box>
      </Fade>
    </Box>
  );
};

export default BatchChecks;
