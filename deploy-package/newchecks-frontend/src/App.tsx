import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItemText,
  CssBaseline,
  Box,
  Container,
  ListItemButton,
  Button,
  CircularProgress,
  Collapse,
  ListItemIcon
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import CreateIcon from '@mui/icons-material/Create';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ReceiptIcon from '@mui/icons-material/Receipt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BusinessIcon from '@mui/icons-material/Business';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import PeopleIcon from '@mui/icons-material/People';
import GroupIcon from '@mui/icons-material/Group';
import WorkIcon from '@mui/icons-material/Work';

import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

import Login from './Login';
import Clients from './components/Clients';
import Employees from './components/Employees';
import Companies from './components/Companies';
import Bank from './components/Bank';
import Dashboard from './components/Dashboard';
import UsersPage from './components/users';
import BatchChecks from './components/checks';
import Checks from './components/viewchecks';
import OptimizedViewChecks from './components/OptimizedViewChecks';
import Report from './components/Report';
import { useOptimizedData } from './hooks/useOptimizedData';

const drawerWidth = 220;

       const mainMenuItems = [
         { text: 'Dashboard', icon: <DashboardIcon />, section: 'Dashboard' },
         { text: 'Create Checks', icon: <ReceiptIcon />, section: 'Checks' },
         { text: 'View Checks', icon: <VisibilityIcon />, section: 'View Checks' },
         { text: 'Report', icon: <AssessmentIcon />, section: 'Report' },
];

const createSubMenuItems = [
  { text: 'Companies', icon: <BusinessIcon />, section: 'Companies' },
  { text: 'Banks', icon: <AccountBalanceIcon />, section: 'Banks' },
  { text: 'Users', icon: <PeopleIcon />, section: 'Users' },
  { text: 'Clients', icon: <GroupIcon />, section: 'Clients' },
  { text: 'Employees', icon: <WorkIcon />, section: 'Employees' },
];
const ensureUserDocExists = async (user: FirebaseUser) => {
  const userRef = doc(db, 'users', user.uid);
  const docSnap = await getDoc(userRef);

  if (!docSnap.exists()) {
    console.warn('🆕 No user doc found. Creating one...');
    await setDoc(userRef, {
      role: 'user',
      active: true,
      email: user.email || '',
      companyIds: [], // You can update this based on app logic
    });
  } else {
    console.log('✅ User doc already exists');
  }
};



function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSection, setSelectedSection] = useState('Dashboard');
  const [currentRole, setCurrentRole] = useState<string>('user');
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [createSubmenuOpen, setCreateSubmenuOpen] = useState(false);

  const [navigatedFromDashboard, setNavigatedFromDashboard] = useState(false);


  // filter for Checks page
  const [viewFilter, setViewFilter] = useState<{
    companyId?: string | { in: string[] };
    weekKey?: string;
    createdBy?: string;
  }>({});
  

  // clear filter
  const handleClearFilter = () => {
    console.log('🧹 handleClearFilter called, resetting filter');
    setViewFilter({});
    setSelectedSection('View Checks');
  };

  useEffect(() => {
    if (selectedSection !== 'View Checks') {
      setNavigatedFromDashboard(false);
    }
  }, [selectedSection]);
   
  useEffect(() => {
    console.log('setting up auth listener');
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('onAuthStateChanged', firebaseUser);
      // Always clear state first!
      setUser(firebaseUser);
      setCurrentRole('user');
      setUserId(null);
      setCompanyIds([]);
      setViewFilter({});
      setSelectedSection('Dashboard');
      if (firebaseUser) {
        try {
          await ensureUserDocExists(firebaseUser); 
          const docSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setCurrentRole(data.role || 'user');
            setUserId(firebaseUser.uid);
            setCompanyIds(data.companyIds || []);
            console.log('[CHECKPOINT] User doc loaded:', data);
          } else {
            console.warn('[CHECKPOINT] User doc not found for uid:', firebaseUser.uid);
          }
        } catch (err) {
          console.error('[CHECKPOINT] Error fetching user doc:', err);
        }
      } else {
        console.log('user signed out');
        setCurrentRole('user');
      }
      setAuthChecked(true);
      if (typeof refetchChecks === 'function') refetchChecks();
    });
    return () => unsubscribe();
  }, []);

  // Load user info once
  useEffect(() => {
    const fetchUser = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      setCurrentRole(userData.role || 'user');
      setCompanyIds(userData.companyIds || []);
    };
    fetchUser();
  }, []);

  // Memoize options for useOptimizedData
  const usersOptions = useMemo(() => {
    return {
      userRole: currentRole,
      userId: auth.currentUser?.uid
    };
  }, [currentRole]);
  const companiesOptions = useMemo(() => {
    return {
      userRole: currentRole,
      companyIds
    };
  }, [currentRole, companyIds]);
  const checksOptions = useMemo(() => {
    return {
      userRole: currentRole,
      companyIds
    };
  }, [currentRole, companyIds]);

  const { data: users, loading: usersLoading } = useOptimizedData<any>('users', {}, usersOptions);

  // Always call hooks, but skip fetching if companyIds not ready (for non-admins)
  const shouldFetch = currentRole === 'admin' || (companyIds && companyIds.length > 0);
  const { data: companies, loading: companiesLoading } = useOptimizedData<any>('companies', {}, { ...companiesOptions, skip: !shouldFetch });
  // In the Dashboard checks query/filter logic:
  const checksFilter = currentRole === 'admin'
  ? {}
  : (companyIds.length > 0
      ? { companyId: companyIds }
      : {});

  console.log('[CHECKPOINT] [App] Dashboard checks filter:', checksFilter, 'currentRole:', currentRole, 'companyIds:', companyIds);
  const { data: checks, loading: checksLoading, refetch: refetchChecks } = useOptimizedData<any>(
    'checks',
    checksFilter,
    { ...checksOptions, skip: !shouldFetch }
  );

  const handleLogout = async () => {
    console.log('handleLogout called');
    await signOut(auth);
    setUser(null);
    setCurrentRole('user');
    setUserId(null);
    setCompanyIds([]);
    if (currentRole !== 'admin') {
      setViewFilter({ companyId: { in: companyIds } });
    } else {
      setViewFilter({});
    }
    
    
    setSelectedSection('Dashboard');
  };

  const dashboardRef = useRef<any>(null);
  const handleReviewUpdated = () => {
    if (dashboardRef.current && typeof dashboardRef.current.fetchReviewRequests === 'function') {
      dashboardRef.current.fetchReviewRequests();
    }
  };

  if (!authChecked) return null;
  if (!user) {
    console.log('🛑 not logged in, showing login');
    return <Login onLogin={() => setUser(auth.currentUser)} />;
  }
  // Only render main app after user info is loaded
  if (!authChecked || !user) {
    console.log('🛑 not logged in, showing login');
    return <Login onLogin={() => setUser(auth.currentUser)} />;
  }

  const stillLoadingData =
    currentRole !== 'admin' && (!companyIds || !Array.isArray(companyIds) || companyIds.length === 0);

  if (stillLoadingData) {
    console.log('⏳ Waiting for companyIds to load...');
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading your data...</Typography>
      </Box>
    );
  }


  // Note: availableSections is used for future reference if needed
  // const availableSections = currentRole === 'admin' 
  //   ? [...mainMenuItems, ...createSubMenuItems]
  //   : [...mainMenuItems, { text: 'Employees', icon: <WorkIcon />, section: 'Employees' }];

  console.log('🔎 rendering App, selectedSection=', selectedSection);
  console.log('🔎 current viewFilter=', viewFilter);

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            NewChecks Payroll System
          </Typography>
          {currentRole && (
            <Typography sx={{ mr: 2 }}>
              Logged in as: {currentRole.toUpperCase()}
            </Typography>
          )}
          <Button color="inherit" onClick={handleLogout}>Logout</Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: 'auto' }}>
          <List>
            {/* Main Menu Items */}
            {mainMenuItems
              .filter((item) => {
                // Hide Report section for non-admin users
                if (item.section === 'Report' && currentRole !== 'admin') {
                  return false;
                }
                return true;
              })
              .map((item) => (
                <ListItemButton
                key={item.section}
                selected={selectedSection === item.section}
                  onClick={() => {
                  console.log(`🖱️ Menu click: ${item.section}`);
                    if (
                    item.section === 'View Checks' &&
                      selectedSection !== 'View Checks' &&
                      Object.keys(viewFilter).length === 0
                    ) {
                      console.log('🧹 Clearing viewFilter because menu clicked without active filter');
                      setViewFilter({});
                    }
                    setNavigatedFromDashboard(false);
                  setSelectedSection(item.section);
                  }}
                >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            ))}
            
            {/* Create Submenu (Admin Only) */}
            {currentRole === 'admin' && (
              <>
                <ListItemButton
                  onClick={() => setCreateSubmenuOpen(!createSubmenuOpen)}
                  sx={{ pl: 2 }}
                >
                  <ListItemIcon><CreateIcon /></ListItemIcon>
                  <ListItemText primary="Manage" />
                  {createSubmenuOpen ? <ExpandLess /> : <ExpandMore />}
                </ListItemButton>
                
                <Collapse in={createSubmenuOpen} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {createSubMenuItems.map((item) => (
                      <ListItemButton
                        key={item.section}
                        selected={selectedSection === item.section}
                        onClick={() => {
                          console.log(`🖱️ Submenu click: ${item.section}`);
                          setSelectedSection(item.section);
                        }}
                        sx={{ pl: 4 }}
                      >
                        <ListItemIcon>{item.icon}</ListItemIcon>
                        <ListItemText primary={item.text} />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
              </>
            )}
            
            {/* Employees for non-admin users */}
            {currentRole !== 'admin' && (
              <ListItemButton
                selected={selectedSection === 'Employees'}
                onClick={() => {
                  console.log(`🖱️ Menu click: Employees`);
                  setSelectedSection('Employees');
                }}
              >
                <ListItemIcon><WorkIcon /></ListItemIcon>
                <ListItemText primary="Employees" />
              </ListItemButton>
            )}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        <Container>
          {selectedSection === 'Dashboard' && (
            <Dashboard
              ref={dashboardRef}
              onGoToViewChecks={(companyId, weekKey, createdBy) => {
                console.log('➡️ Dashboard → View Checks with filter', {
                  companyId,
                  weekKey,
                  createdBy,
                });
                setViewFilter({ companyId, weekKey, createdBy });
                setNavigatedFromDashboard(true);
                setSelectedSection('View Checks');
              }}
              onGoToSection={setSelectedSection}
              currentRole={currentRole}
            />
          )}

          {selectedSection === 'Companies' && <Companies />}
          {selectedSection === 'Banks' && <Bank />}
          {selectedSection === 'Users' && <UsersPage />}
          {selectedSection === 'Clients' && <Clients companyIds={companyIds} />}
          {selectedSection === 'Employees' && (
            <Employees currentRole={currentRole} companyIds={companyIds} />
          )}
          {selectedSection === 'Checks' && (
                            <BatchChecks onChecksCreated={refetchChecks} onGoToSection={setSelectedSection} />
          )}

          {selectedSection === 'View Checks' && (
            <OptimizedViewChecks
              filter={viewFilter}
              onClearFilter={handleClearFilter}
              users={users}
              companies={currentRole === 'admin' ? companies : companies.filter(c => companyIds.includes(c.id))}
              checks={checks}
              usersLoading={usersLoading}
              companiesLoading={companiesLoading}
              checksLoading={checksLoading}
              onReviewUpdated={handleReviewUpdated}
              refetchChecks={refetchChecks}
              currentRole={currentRole}
              companyIds={companyIds}
            />
          )}

          {selectedSection === 'Report' && <Report />}
        </Container>
      </Box>
    </Box>
  );
}

export default App;
