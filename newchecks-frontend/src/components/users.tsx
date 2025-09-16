import React, { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc, // ✅ added setDoc
} from "firebase/firestore";
import { db, auth } from "../firebase"; // ✅ import auth
import { createUserWithEmailAndPassword } from "firebase/auth"; // ✅ import createUserWithEmailAndPassword
import {
  Paper,
  Typography,
  Button,
  ListItem,
  ListItemButton,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Box,
  Chip,
  FormControlLabel,
  Switch,
  Alert,
  Tooltip,
} from "@mui/material";
import {
  Print,
  PrintDisabled,
  Security,
} from '@mui/icons-material';

interface Company {
  id: string;
  name: string;
}

interface User {
  id: string;
  username: string;
  email?: string;
  password: string;
  role: string;
  active: boolean;
  companyIds?: string[];
  canPrintChecks?: boolean; // ✅ New field for check printing permission
}

const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user dialog
  const [openForm, setOpenForm] = useState(false);
  const [email, setEmail] = useState(""); // ✅ added email
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [canPrintChecks, setCanPrintChecks] = useState(false); // ✅ New state for create form

  // Details dialog
  const [openDetails, setOpenDetails] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editCanPrintChecks, setEditCanPrintChecks] = useState(false); // ✅ New state for edit form

  // fetch data
  const fetchAll = async () => {
    const snapUsers = await getDocs(collection(db, "users"));
    const uList: User[] = snapUsers.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        username: data.username,
        email: data.email || "",
        password: data.password,
        role: data.role,
        active: data.active ?? true,
        companyIds: Array.isArray(data.companyIds) ? data.companyIds : [],
        canPrintChecks: data.canPrintChecks ?? false, // ✅ Load printing permission
      };
    });
    setUsers(uList);

    const snapCompanies = await getDocs(collection(db, "companies"));
    const cList: Company[] = snapCompanies.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name,
      };
    });
    setCompanies(cList);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll().catch(console.error);
  }, []);

  // ✅ Updated to also create Auth user
  const handleSave = async () => {
    if (!email.trim() || !username.trim() || !password.trim()) {
      alert("Please enter email, username and password");
      return;
    }
    try {
      // 1. Create in Firebase Auth
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // 2. Save extra profile data in Firestore with UID as doc ID
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email,
        username,
        password, // ⚠️ for demo only; avoid storing plain text in production
        role,
        active: true,
        companyIds,
        canPrintChecks, // ✅ Save printing permission
        createdAt: serverTimestamp(),
      });

      setOpenForm(false);
      setEmail("");
      setUsername("");
      setPassword("");
      setRole("user");
      setCompanyIds([]);
      setCanPrintChecks(false); // Reset new state
      fetchAll();
      alert("✅ User created and can now log in!");
    } catch (err: any) {
      console.error(err);
      alert("❌ Failed to create user: " + err.message);
    }
  };

  const handleOpenDetails = (user: User) => {
    setSelectedUser(user);
    setEditPassword(user.password);
    setEditCompanies(user.companyIds || []);
    setEditActive(user.active);
    setEditCanPrintChecks(user.canPrintChecks ?? false); // Set new state for edit
    setOpenDetails(true);
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;
    
    // Only update fields that actually changed
    const updates: any = {};
    
    if (editPassword !== selectedUser.password) {
      // Only update password if it's not empty (user actually wants to change it)
      if (editPassword && editPassword.trim() !== '') {
        updates.password = editPassword;
      }
    }
    
    if (editActive !== selectedUser.active) {
      updates.active = editActive;
    }
    
    if (JSON.stringify(editCompanies) !== JSON.stringify(selectedUser.companyIds || [])) {
      updates.companyIds = editCompanies;
    }
    
    if (editCanPrintChecks !== selectedUser.canPrintChecks) {
      updates.canPrintChecks = editCanPrintChecks;
    }
    
    // Only update if there are actual changes
    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "users", selectedUser.id), updates);
      setOpenDetails(false);
      fetchAll();
    } else {
      alert("No changes to save");
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    await deleteDoc(doc(db, "users", selectedUser.id));
    setOpenDetails(false);
    fetchAll();
  };

  if (loading) return <Typography>Loading users...</Typography>;

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" gutterBottom fontWeight="bold" sx={{ color: '#1976d2' }}>
        Users
      </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage user accounts and printing permissions
        </Typography>
      </Box>
      
      {/* Printing Permission Summary */}
      <Paper elevation={2} sx={{ p: 3, mb: 4, borderRadius: 3, backgroundColor: '#f8f9fa', border: '1px solid', borderColor: 'grey.200' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Security color="primary" sx={{ fontSize: 28 }} />
            <Typography variant="h5" color="primary" fontWeight="bold">
                Check Printing Permissions
              </Typography>
            </Box>
            
          <Box sx={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Box sx={{ textAlign: 'center', minWidth: 80 }}>
              <Typography variant="h4" color="success.main" fontWeight="bold">
                  {users.filter(u => u.canPrintChecks).length}
                </Typography>
              <Typography variant="body2" color="success.main" fontWeight="medium">
                  Can Print
                </Typography>
              </Box>
              
            <Box sx={{ textAlign: 'center', minWidth: 80 }}>
              <Typography variant="h4" color="error.main" fontWeight="bold">
                  {users.filter(u => !u.canPrintChecks).length}
                </Typography>
              <Typography variant="body2" color="error.main" fontWeight="medium">
                  Cannot Print
                </Typography>
              </Box>
              
            <Box sx={{ textAlign: 'center', minWidth: 80 }}>
              <Typography variant="h4" color="info.main" fontWeight="bold">
                {users.length}
              </Typography>
              <Typography variant="body2" color="info.main" fontWeight="medium">
                  Total Users
                </Typography>
              </Box>
            </Box>
          </Box>
        </Paper>

      {/* Create User Button */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
      <Button
        variant="contained"
        color="primary"
          size="large"
        onClick={() => setOpenForm(true)}
          sx={{
            borderRadius: 2,
            px: 3,
            py: 1.5,
            textTransform: 'none',
            fontWeight: 'bold',
            boxShadow: 2,
            '&:hover': {
              boxShadow: 4,
              transform: 'translateY(-1px)',
            },
            transition: 'all 0.2s ease-in-out',
          }}
      >
          + CREATE USER
      </Button>
      </Box>

      {/* Users List */}
      <Paper elevation={1} sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {users.map((u, index) => {
          const assignedCompanies = u.companyIds
            ?.map((cid) => companies.find((c) => c.id === cid)?.name)
            .filter(Boolean)
            .join(", ");
          
          // Fix undefined username issue
          const displayUsername = u.username || u.email || 'Unknown User';
          
          return (
            <Box key={u.id}>
              <ListItem 
                disablePadding
                sx={{
                  '&:hover': {
                    backgroundColor: 'rgba(25, 118, 210, 0.04)',
                  },
                  transition: 'background-color 0.2s ease',
                }}
              >
                <ListItemButton 
                  onClick={() => handleOpenDetails(u)}
                  sx={{ py: 2, px: 3 }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                        <Typography variant="h6" fontWeight="bold" color="text.primary">
                          {displayUsername}
                        </Typography>
                        <Chip 
                          label={u.role} 
                          size="small" 
                          color={u.role === 'admin' ? 'error' : 'default'}
                          sx={{ fontWeight: 'medium' }}
                        />
                        <Chip 
                          label={u.active ? 'Active' : 'Inactive'} 
                          size="small" 
                          color={u.active ? 'success' : 'error'}
                          variant="outlined"
                        />
                      </Box>
                      
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {u.email || 'No email provided'}
                          </Typography>
                      
                      <Typography variant="body2" color="text.secondary">
                        <strong>Companies:</strong> {assignedCompanies || 'No companies assigned'}
                      </Typography>
                    </Box>
                          
                          {/* Check Printing Permission Indicator */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
                          <Tooltip title={u.canPrintChecks ? "Can print checks" : "Cannot print checks"}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {u.canPrintChecks ? (
                            <Print color="success" fontSize="medium" />
                              ) : (
                            <PrintDisabled color="disabled" fontSize="medium" />
                              )}
                              <Typography 
                            variant="body2" 
                                color={u.canPrintChecks ? "success.main" : "text.disabled"}
                            fontWeight="medium"
                              >
                                {u.canPrintChecks ? "Can Print" : "No Print"}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </Box>
                  </Box>
                </ListItemButton>
              </ListItem>
              {index < users.length - 1 && <Divider />}
            </Box>
          );
        })}
      </Paper>

      {/* Create User Dialog */}
      <Dialog
        open={openForm}
        onClose={() => setOpenForm(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Create User</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
        >
          <TextField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FormControl fullWidth>
            <InputLabel id="role-label">Role</InputLabel>
            <Select
              labelId="role-label"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="user">User</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="companies-label">Assign Companies</InputLabel>
            <Select
              labelId="companies-label"
              multiple
              value={companyIds}
              onChange={(e) =>
                setCompanyIds(
                  typeof e.target.value === "string"
                    ? e.target.value.split(",")
                    : (e.target.value as string[])
                )
              }
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {(selected as string[]).map((value) => {
                    const company = companies.find((c) => c.id === value);
                    return <Chip key={value} label={company?.name || value} />;
                  })}
                </Box>
              )}
            >
              {companies.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={canPrintChecks}
                onChange={(e) => setCanPrintChecks(e.target.checked)}
                name="canPrintChecks"
                color="primary"
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Print color="primary" fontSize="small" />
                Can Print Checks
              </Box>
            }
          />
          
          {/* Help text for printing permission */}
          <Alert severity="info" sx={{ mt: 1 }}>
            <Typography variant="body2">
              <strong>Check Printing Permission:</strong> Users with this permission enabled will be able to print checks when viewing the Checks page. 
              This is a security feature to control who can generate physical checks.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenForm(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Details Dialog */}
      <Dialog
        open={openDetails}
        onClose={() => setOpenDetails(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>User Details</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <Typography>Username: {selectedUser?.username}</Typography>
          <TextField
            label="Password"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
          />
          <FormControlLabel
            control={
              <Switch
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
            }
            label={editActive ? "Active" : "Inactive"}
          />
          <FormControlLabel
            control={
              <Switch
                checked={editCanPrintChecks}
                onChange={(e) => setEditCanPrintChecks(e.target.checked)}
                name="editCanPrintChecks"
                color="primary"
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Print color="primary" fontSize="small" />
                {editCanPrintChecks ? "Can Print Checks" : "Cannot Print Checks"}
              </Box>
            }
          />
          
          {/* Help text for editing printing permission */}
          <Alert severity="info" sx={{ mt: 1 }}>
            <Typography variant="body2">
              <strong>Printing Permission:</strong> {editCanPrintChecks 
                ? "This user can currently print checks from the Checks page." 
                : "This user cannot print checks. Enable this permission to allow check printing."
              }
            </Typography>
          </Alert>
          <FormControl fullWidth>
            <InputLabel id="edit-companies-label">Assign Companies</InputLabel>
            <Select
              labelId="edit-companies-label"
              multiple
              value={editCompanies}
              onChange={(e) =>
                setEditCompanies(
                  typeof e.target.value === "string"
                    ? e.target.value.split(",")
                    : (e.target.value as string[])
                )
              }
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {(selected as string[]).map((value) => {
                    const company = companies.find((c) => c.id === value);
                    return <Chip key={value} label={company?.name || value} />;
                  })}
                </Box>
              )}
            >
              {companies.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          {selectedUser && (
            <Button color="error" onClick={handleDeleteUser}>
              Delete User
            </Button>
          )}
          <Button onClick={() => setOpenDetails(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdateUser}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UsersPage;
