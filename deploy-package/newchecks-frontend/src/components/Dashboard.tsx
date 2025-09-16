import React, { useEffect, useState, forwardRef } from "react";
import {
  Box,
  Typography,
  Avatar,
  Paper,
  Divider,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ButtonBase,
  Card,
  CardContent,
} from "@mui/material";
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PrintIcon from '@mui/icons-material/Print';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid
  // Tooltip is intentionally NOT imported from recharts
} from "recharts";
// Remove Grid import
// import Grid from "@mui/material/Grid";

interface DashboardProps {
  onGoToViewChecks: (companyId: string, weekKey: string, createdBy: string) => void;
  onGoToSection: (section: string) => void;
  currentRole: string;
}



interface Company {
  id: string;
  name: string;
  address: string;
  logoBase64?: string;
}
interface Employee {
  id: string;
  name: string;
}
interface Client {
  id: string;
  name: string;
}
interface Check {
  id: string;
  amount: number;
  companyId: string;
  employeeName: string;
  memo?: string;
  status?: string;
  date?: any;
  createdBy?: string;
  reviewed?: boolean;
}

interface UserInfo {
  id: string;
  username: string;
  email?: string;
}

const Dashboard = forwardRef<any, DashboardProps>(({ onGoToViewChecks, onGoToSection, currentRole }, ref) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [allChecks, setAllChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentChecks, setRecentChecks] = useState<Check[]>([]);
  const [usersMap, setUsersMap] = useState<{ [uid: string]: UserInfo }>({});
  // Add companyIds state for use in queries
  const [companyIds, setCompanyIds] = useState<string[]>([]);

  // Helper function to safely format amounts
  const formatAmount = (amount: any): string => {
    if (amount === null || amount === undefined) return '0.00';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return '0.00';
    return numAmount.toFixed(2);
  };

  useEffect(() => {
    const fetchBaseData = async () => {
      try {
        // Fetch companies for all users (not just admin)
        const cSnap = await getDocs(collection(db, "companies"));
        setCompanies(cSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

        if (currentRole === 'admin') {
          const clSnap = await getDocs(collection(db, "clients"));
          setClients(clSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

          const uSnap = await getDocs(collection(db, "users"));
          const map: { [uid: string]: UserInfo } = {};
          uSnap.docs.forEach((docu) => {
            const data = docu.data() as any;
            map[data.uid || docu.id] = {
              id: docu.id,
              username: data.username || data.email || "Unknown",
              email: data.email,
            };
          });
          setUsersMap(map);
        }

        const eSnap = await getDocs(collection(db, "employees"));
        setEmployees(eSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

        setLoading(false);
      } catch (err) {
        console.error("Error fetching data:", err);
        setLoading(false);
      }
    };
    fetchBaseData();
  }, [currentRole]);

  useEffect(() => {
    const fetchRoleAndChecks = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        let role = "user";
        let fetchedCompanyIds: string[] = [];
        if (snap.exists()) {
          const data = snap.data() as any;
          role = data.role || "user";
          fetchedCompanyIds = data.companyIds || [];
        }
        setCompanyIds(fetchedCompanyIds);
        console.log('[CHECKPOINT] Dashboard companyIds:', fetchedCompanyIds);
        // setCurrentRole(role); // Now passed as prop

        let checks: Check[] = [];
        if (role === "admin") {
          const q = query(collection(db, "checks"), orderBy("date", "desc"));
          const snapChecks = await getDocs(q);
          checks = snapChecks.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          }));
        } else {
          // For users, only fetch checks for their assigned companies
          if (fetchedCompanyIds.length === 0) {
            setRecentChecks([]);
            return;
          }
          // Chunk companyIds into groups of 10 for Firestore 'in' queries
          const chunks: string[][] = [];
          for (let i = 0; i < fetchedCompanyIds.length; i += 10) {
            chunks.push(fetchedCompanyIds.slice(i, i + 10));
          }
          for (const chunk of chunks) {
            const q = query(
              collection(db, "checks"),
              where("companyId", "in", chunk),
              orderBy("date", "desc")
            );
            const snap = await getDocs(q);
            console.log('[CHECKPOINT] Dashboard: fetched checks for chunk', chunk, snap.docs.map(d => d.id));
            snap.docs.forEach(d => {
              checks.push({ id: d.id, ...(d.data() as any) });
            });
          }
          console.log('[CHECKPOINT] Dashboard: all fetched checks:', checks);
        }
        setRecentChecks(checks.slice(0, 6));
      } catch (err) {
        console.error("Error fetching checks:", err);
      }
    };
    fetchRoleAndChecks();
  }, []);



  // Fetch all checks for admin users
  useEffect(() => {
    if (currentRole === 'admin') {
      const fetchAllChecks = async () => {
        try {
          const snap = await getDocs(collection(db, "checks"));
          setAllChecks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        } catch (err) {
          console.error("Error fetching all checks:", err);
        }
      };
      fetchAllChecks();
    }
  }, [currentRole]);

  if (loading) {
    return (
      <Box sx={{ mt: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  const chartData = [
    { name: "Companies", count: companies.length },
    { name: "Batch a Checks", count: employees.length },
    { name: "Clients", count: clients.length },
  ];

  return (
    <Box
      sx={{
        mt: 4,
        display: "flex",
        justifyContent: "center",
        background: "linear-gradient(to bottom right, #f0f4ff, #ffffff)",
        minHeight: "100vh",
        p: 3,
      }}
    >
      <Paper
        elevation={4}
        sx={{
          p: 4,
          borderRadius: 4,
          width: "100%",
          maxWidth: 1400,
          backgroundColor: "#ffffff",
          boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
        }}
      >
        {/* WELCOME BANNER */}
        {currentRole === 'admin' ? (
          <>
            <Box
              sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#1976d2', color: '#fff', borderRadius: 3, p: 3, boxShadow: '0 2px 8px rgba(25,118,210,0.08)' }}
            >
              <Box>
                <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: 1 }}>
                  Welcome, Admin!
                </Typography>
                <Typography variant="subtitle1">NewChecks Payroll System</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                
                <Typography variant="body2">Today: {new Date().toLocaleDateString()}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 4 }}>
              <ButtonBase
                sx={{ flex: '1 1 220px', minWidth: 220, maxWidth: 350, borderRadius: 3, display: 'block' }}
                onClick={() => onGoToSection('Companies')}
                focusRipple
              >
                <Card sx={{ p: 2, borderRadius: 3, background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)', color: '#fff', boxShadow: '0 4px 20px rgba(25,118,210,0.3)' }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <BusinessIcon sx={{ fontSize: 40 }} />
                    <Box>
                      <Typography variant="h6">Companies</Typography>
                      <Typography variant="h4">{companies.length}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </ButtonBase>
              <ButtonBase
                sx={{ flex: '1 1 220px', minWidth: 220, maxWidth: 350, borderRadius: 3, display: 'block' }}
                onClick={() => onGoToSection('Clients')}
                focusRipple
              >
                <Card sx={{ p: 2, borderRadius: 3, background: 'linear-gradient(135deg, #43a047 0%, #66bb6a 100%)', color: '#fff', boxShadow: '0 4px 20px rgba(67,160,71,0.3)' }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <PeopleIcon sx={{ fontSize: 40 }} />
                    <Box>
                      <Typography variant="h6">Clients</Typography>
                      <Typography variant="h4">{clients.length}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </ButtonBase>
              <ButtonBase
                sx={{ flex: '1 1 220px', minWidth: 220, maxWidth: 350, borderRadius: 3, display: 'block' }}
                onClick={() => onGoToSection('Checks')}
                focusRipple
              >
                <Card sx={{ p: 2, borderRadius: 3, background: 'linear-gradient(135deg, #ef6c00 0%, #ffa726 100%)', color: '#fff', boxShadow: '0 4px 20px rgba(239,108,0,0.3)' }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <AssignmentIcon sx={{ fontSize: 40 }} />
                    <Box>
                      <Typography variant="h6">Batch a Checks</Typography>
                      <Typography variant="h4">{employees.length}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </ButtonBase>
            </Box>
          </>
        ) : (
          <Box sx={{ mb: 4, p: 3, borderRadius: 3, bgcolor: '#1976d2', color: '#fff', boxShadow: '0 2px 8px rgba(25,118,210,0.08)', textAlign: 'center' }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: 1 }}>
              Welcome, User!
            </Typography>
            <Typography variant="subtitle1">Payroll System</Typography>
            <Typography variant="body2" sx={{ mt: 2 }}>Today: {new Date().toLocaleDateString()}</Typography>
          </Box>
        )}
        {/* For users, show only their last 6 checks */}
        {currentRole !== 'admin' && recentChecks.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold', textAlign: 'center' }}>Your Recent Checks</Typography>
            <List>
              {recentChecks.slice(0, 6).map((check) => {
                const company = companies.find((c) => c.id === check.companyId);
                return (
                  <ListItem key={check.id}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: '#1976d2' }}>{company?.name?.charAt(0) || 'C'}</Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={<span><b>{company?.name || 'Unknown Company'}</b> - <b>{check.employeeName}</b> (${formatAmount(check.amount)})</span>}
                      secondary={<span>Date: {check.date?.toDate ? check.date.toDate().toLocaleString() : check.date}</span>}
                    />
                  </ListItem>
                );
              })}
            </List>
          </Box>
        )}
        {/* QUICK ACTIONS */}
        {/* Only show admin recent activity if admin */}
        {currentRole === 'admin' && (
          <>
            {/* RECENT ACTIVITY TIMELINE */}
            <Divider sx={{ my: 3 }} />
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold' }}>🕒 Recent Activity</Typography>
            <List>
              {recentChecks.length > 0 ? recentChecks.map((check) => {
                const company = companies.find((c) => c.id === check.companyId);
                const creatorName = check.createdBy && usersMap[check.createdBy] ? usersMap[check.createdBy].username : 'Unknown';
                return (
                  <ListItem key={check.id}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: '#1976d2' }}>{company?.name?.charAt(0) || 'C'}</Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={<span><b>{company?.name || 'Unknown Company'}</b> - <b>{check.employeeName}</b> (${formatAmount(check.amount)})</span>}
                      secondary={<span>By {creatorName} on {check.date?.toDate ? check.date.toDate().toLocaleString() : check.date}</span>}
                    />
                  </ListItem>
                );
              }) : <Typography>No recent activity found.</Typography>}
            </List>
          </>
        )}
        {/* APP INFO CARD */}
        <Divider sx={{ my: 3 }} />
        <Box sx={{ mt: 4, p: 3, borderRadius: 3, bgcolor: '#f5f5f5', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}> Support</Typography>
          
          <Typography variant="body2">For support, contact: <a href="mailto:carlos@avriologistics.com">carlos@avriologistics.com</a></Typography>
        </Box>
      </Paper>
    </Box>
  );

});

Dashboard.displayName = 'Dashboard';
export default Dashboard;
