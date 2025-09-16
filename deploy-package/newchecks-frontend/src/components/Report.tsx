import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  FormControlLabel,
  Checkbox,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab
} from '@mui/material';
import { Download, FilterList, Refresh, ExpandMore, Business, AttachMoney, People } from '@mui/icons-material';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import * as XLSX from 'xlsx';

interface Company {
  id: string;
  name: string;
  active: boolean;
}

interface Client {
  id: string;
  name: string;
  active: boolean;
  companyIds: string[];
}

interface Employee {
  id: string;
  name: string;
  active: boolean;
  companyId: string;
  clientId?: string;
  payType?: string;
  clientPayTypeRelationships?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    payType: string;
    payRate?: string;
  }>;
}

interface Check {
  id: string;
  checkNumber?: number;
  companyId: string;
  employeeId: string;
  clientId: string;
  payType: string;
  amount: number;
  hours?: number;
  payRate?: number;
  overtimeHours?: number;
  overtimeRate?: number;
  holidayHours?: number;
  holidayRate?: number;
  perdiemAmount?: number;
  perdiemBreakdown?: boolean;
  perdiemMonday?: number;
  perdiemTuesday?: number;
  perdiemWednesday?: number;
  perdiemThursday?: number;
  perdiemFriday?: number;
  perdiemSaturday?: number;
  perdiemSunday?: number;
  workWeek: string;
  weekKey: string;
  date: any;
  memo?: string;
  paid: boolean;
  reviewed: boolean;
  createdBy: string;
  relationshipDetails?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    payType: string;
  }>;
}

interface ReportFilters {
  companyId?: string;
  startDate?: string;
  endDate?: string;
  includeInactive: boolean;
  includeUnpaid: boolean;
  includeUnreviewed: boolean;
}

interface CompanyReport {
  company: Company;
  totalChecks: number;
  totalAmount: number;
  clientBreakdown: Array<{
    clientId: string;
    clientName: string;
    totalChecks: number;
    totalAmount: number;
    hourlyAmount: number;
    perdiemAmount: number;
    checks: Check[];
  }>;
  checks: Check[];
}

const Report: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  
  const [filters, setFilters] = useState<ReportFilters>({
    includeInactive: false,
    includeUnpaid: true,
    includeUnreviewed: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch companies
      const companiesSnap = await getDocs(collection(db, 'companies'));
      const companiesData = companiesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Company[];
      setCompanies(companiesData);

      // Fetch clients
      const clientsSnap = await getDocs(collection(db, 'clients'));
      const clientsData = clientsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Client[];
      setClients(clientsData);

      // Fetch employees
      const employeesSnap = await getDocs(collection(db, 'employees'));
      const employeesData = employeesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Employee[];
      setEmployees(employeesData);

      // Fetch checks
      const checksSnap = await getDocs(query(
        collection(db, 'checks'),
        orderBy('date', 'desc')
      ));
      const checksData = checksSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Check[];
      setChecks(checksData);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to fetch data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getFilteredData = () => {
    let filteredChecks = checks;

    // Apply company filter
    if (filters.companyId) {
      filteredChecks = filteredChecks.filter(check => check.companyId === filters.companyId);
    }

    // Apply date filters
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      filteredChecks = filteredChecks.filter(check => {
        const checkDate = check.date?.toDate ? check.date.toDate() : new Date(check.date);
        return checkDate >= startDate;
      });
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      filteredChecks = filteredChecks.filter(check => {
        const checkDate = check.date?.toDate ? check.date.toDate() : new Date(check.date);
        return checkDate <= endDate;
      });
    }

    // Apply status filters
    if (!filters.includeUnpaid) {
      filteredChecks = filteredChecks.filter(check => check.paid);
    }

    if (!filters.includeUnreviewed) {
      filteredChecks = filteredChecks.filter(check => check.reviewed);
    }

    return filteredChecks;
  };

  const generateCompanyReports = (): CompanyReport[] => {
    const filteredChecks = getFilteredData();
    const companyReports: CompanyReport[] = [];

    companies.forEach(company => {
      const companyChecks = filteredChecks.filter(check => check.companyId === company.id);
      
      if (companyChecks.length === 0) return;

      const totalAmount = companyChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
      
      // Group by client
      const clientMap = new Map<string, { clientId: string; clientName: string; checks: Check[] }>();
      
      companyChecks.forEach(check => {
        let clientName = 'Unknown Client';
        let clientId = check.clientId;
        
        // Get client name from relationship details if available
        if (check.relationshipDetails && check.relationshipDetails.length > 0) {
          clientName = check.relationshipDetails.map(rel => rel.clientName).join(', ');
          clientId = check.relationshipDetails.map(rel => rel.clientId).join(',');
        } else {
          const client = clients.find(c => c.id === check.clientId);
          clientName = client?.name || 'Unknown Client';
        }

        const key = clientId;
        if (!clientMap.has(key)) {
          clientMap.set(key, { clientId, clientName, checks: [] });
        }
        clientMap.get(key)!.checks.push(check);
      });

      const clientBreakdown = Array.from(clientMap.values()).map(({ clientId, clientName, checks }) => {
        const totalChecks = checks.length;
        const totalAmount = checks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
        
        // Calculate hourly vs per diem amounts
        let hourlyAmount = 0;
        let perdiemAmount = 0;
        
        checks.forEach(check => {
          if (check.payType === 'hourly' || check.payType === 'mixed') {
            const hourlyTotal = (check.hours || 0) * (check.payRate || 0) +
                               (check.overtimeHours || 0) * (check.overtimeRate || 0) +
                               (check.holidayHours || 0) * (check.holidayRate || 0);
            hourlyAmount += hourlyTotal;
          }
          
          if (check.payType === 'perdiem' || check.payType === 'mixed') {
            let perdiemTotal = check.perdiemAmount || 0;
            if (check.perdiemBreakdown) {
              perdiemTotal = (check.perdiemMonday || 0) + 
                            (check.perdiemTuesday || 0) + 
                            (check.perdiemWednesday || 0) + 
                            (check.perdiemThursday || 0) + 
                            (check.perdiemFriday || 0) + 
                            (check.perdiemSaturday || 0) + 
                            (check.perdiemSunday || 0);
            }
            perdiemAmount += perdiemTotal;
          }
        });

        return {
          clientId,
          clientName,
          totalChecks,
          totalAmount,
          hourlyAmount,
          perdiemAmount,
          checks
        };
      });

      companyReports.push({
        company,
        totalChecks: companyChecks.length,
        totalAmount,
        clientBreakdown,
        checks: companyChecks
      });
    });

    return companyReports.sort((a, b) => b.totalAmount - a.totalAmount);
  };

  const exportToExcel = async (companyId?: string) => {
    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      let dataToExport: Check[];
      let filename: string;
      
      if (companyId) {
        // Export individual company report
        const company = companies.find(c => c.id === companyId);
        dataToExport = getFilteredData().filter(check => check.companyId === companyId);
        filename = `${company?.name || 'Company'}_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      } else {
        // Export all data
        dataToExport = getFilteredData();
        filename = `all_companies_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      }

      // Create comprehensive report data
      const reportData = dataToExport.map(check => {
        const company = companies.find(c => c.id === check.companyId);
        const employee = employees.find(e => e.id === check.employeeId);
        const client = clients.find(c => c.id === check.clientId);
        
        // Get client name from relationship details if available
        let clientName = client?.name || 'Unknown Client';
        if (check.relationshipDetails && check.relationshipDetails.length > 0) {
          clientName = check.relationshipDetails.map(rel => rel.clientName).join(', ');
        }

        // Calculate per diem total if breakdown exists
        let perdiemTotal = check.perdiemAmount || 0;
        if (check.perdiemBreakdown) {
          perdiemTotal = (check.perdiemMonday || 0) + 
                        (check.perdiemTuesday || 0) + 
                        (check.perdiemWednesday || 0) + 
                        (check.perdiemThursday || 0) + 
                        (check.perdiemFriday || 0) + 
                        (check.perdiemSaturday || 0) + 
                        (check.perdiemSunday || 0);
        }

        // Calculate hourly total
        const hourlyTotal = (check.hours || 0) * (check.payRate || 0) +
                           (check.overtimeHours || 0) * (check.overtimeRate || 0) +
                           (check.holidayHours || 0) * (check.holidayRate || 0);

        // Ensure amount is a number
        const amount = parseFloat(check.amount?.toString() || '0');

        return {
          'Check Number': check.checkNumber || check.id,
          'Company': company?.name || 'Unknown Company',
          'Employee': employee?.name || 'Unknown Employee',
          'Client(s)': clientName,
          'Pay Type': check.payType,
          'Work Week': check.workWeek,
          'Week Key': check.weekKey,
          'Date': check.date?.toDate ? check.date.toDate().toLocaleDateString() : new Date(check.date).toLocaleDateString(),
          'Hours Worked': check.hours || 0,
          'Pay Rate': check.payRate || 0,
          'Overtime Hours': check.overtimeHours || 0,
          'Overtime Rate': check.overtimeRate || 0,
          'Holiday Hours': check.holidayHours || 0,
          'Holiday Rate': check.holidayRate || 0,
          'Per Diem Amount': perdiemTotal,
          'Per Diem Breakdown': check.perdiemBreakdown ? 'Yes' : 'No',
          'Per Diem Monday': check.perdiemMonday || 0,
          'Per Diem Tuesday': check.perdiemTuesday || 0,
          'Per Diem Wednesday': check.perdiemWednesday || 0,
          'Per Diem Thursday': check.perdiemThursday || 0,
          'Per Diem Friday': check.perdiemFriday || 0,
          'Per Diem Saturday': check.perdiemSaturday || 0,
          'Per Diem Sunday': check.perdiemSunday || 0,
          'Hourly Total': hourlyTotal,
          'Total Amount': amount,
          'Memo': check.memo || ''
        };
      });

      // Create workbook with multiple sheets
      const wb = XLSX.utils.book_new();

      // Main checks sheet with improved formatting
      const wsChecks = XLSX.utils.json_to_sheet(reportData);
      
      // Set column widths for better readability
      const columnWidths = [
        { wch: 12 }, // Check Number
        { wch: 20 }, // Company
        { wch: 25 }, // Employee
        { wch: 25 }, // Client(s)
        { wch: 12 }, // Pay Type
        { wch: 15 }, // Work Week
        { wch: 15 }, // Week Key
        { wch: 12 }, // Date
        { wch: 12 }, // Hours Worked
        { wch: 12 }, // Pay Rate
        { wch: 15 }, // Overtime Hours
        { wch: 15 }, // Overtime Rate
        { wch: 15 }, // Holiday Hours
        { wch: 15 }, // Holiday Rate
        { wch: 18 }, // Per Diem Amount
        { wch: 20 }, // Per Diem Breakdown
        { wch: 18 }, // Per Diem Monday
        { wch: 18 }, // Per Diem Tuesday
        { wch: 18 }, // Per Diem Wednesday
        { wch: 18 }, // Per Diem Thursday
        { wch: 18 }, // Per Diem Friday
        { wch: 18 }, // Per Diem Saturday
        { wch: 18 }, // Per Diem Sunday
        { wch: 15 }, // Hourly Total
        { wch: 15 }, // Total Amount
        { wch: 30 }  // Memo
      ];
      
      wsChecks['!cols'] = columnWidths;
      
      // Add header styling and center-align all data
      const range = XLSX.utils.decode_range(wsChecks['!ref'] || 'A1');
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const address = XLSX.utils.encode_cell({ r: R, c: C });
          if (!wsChecks[address]) continue;
          
          if (R === 0) {
            // Header row styling
            wsChecks[address].s = {
              font: { bold: true, color: { rgb: "FFFFFF" } },
              fill: { fgColor: { rgb: "4472C4" } },
              alignment: { horizontal: "center", vertical: "center" }
            };
          } else {
            // Data rows - center align all content including numbers
            wsChecks[address].s = {
              alignment: { horizontal: "center", vertical: "center" }
            };
          }
        }
      }
      
      // Add total sum row at the bottom
      const totalRow = {
        'Check Number': 'TOTAL',
        'Company': '',
        'Employee': '',
        'Client(s)': '',
        'Pay Type': '',
        'Work Week': '',
        'Week Key': '',
        'Date': '',
        'Hours Worked': dataToExport.reduce((sum, check) => sum + (parseFloat(check.hours?.toString() || '0')), 0),
        'Pay Rate': '',
        'Overtime Hours': '',
        'Overtime Rate': '',
        'Holiday Hours': '',
        'Holiday Rate': '',
        'Per Diem Amount': '',
        'Per Diem Breakdown': '',
        'Per Diem Monday': '',
        'Per Diem Tuesday': '',
        'Per Diem Wednesday': '',
        'Per Diem Thursday': '',
        'Per Diem Friday': '',
        'Per Diem Saturday': '',
        'Per Diem Sunday': '',
        'Hourly Total': '',
        'Total Amount': dataToExport.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0),
        'Memo': ''
      };
      
      // Add total row to the worksheet by appending to the data
      const totalRowData = Object.values(totalRow);
      const totalRowIndex = reportData.length;
      
      // Create a new row in the worksheet for totals
      for (let C = 0; C < totalRowData.length; ++C) {
        const address = XLSX.utils.encode_cell({ r: totalRowIndex, c: C });
        const value = totalRowData[C];
        
        if (typeof value === 'number') {
          wsChecks[address] = { v: value, t: 'n' };
        } else {
          wsChecks[address] = { v: value, t: 's' };
        }
        
        // Style the total row with bold text and different background
        wsChecks[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E6E6E6" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      }
      
      XLSX.utils.book_append_sheet(wb, wsChecks, 'Checks');

      // Company summary sheet with improved formatting
      const companyReports = generateCompanyReports();
      const companySummary = companyReports.map(report => ({
        'Company': report.company.name,
        'Total Checks': report.totalChecks,
        'Total Amount': report.totalAmount,
        'Active': report.company.active ? 'Yes' : 'No'
      }));
      const wsCompanySummary = XLSX.utils.json_to_sheet(companySummary);
      
      // Set column widths for company summary
      wsCompanySummary['!cols'] = [
        { wch: 25 }, // Company
        { wch: 15 }, // Total Checks
        { wch: 18 }, // Total Amount
        { wch: 10 }  // Active
      ];
      
      // Add header styling
      const companyRange = XLSX.utils.decode_range(wsCompanySummary['!ref'] || 'A1');
      for (let C = companyRange.s.c; C <= companyRange.e.c; ++C) {
        const address = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!wsCompanySummary[address]) continue;
        wsCompanySummary[address].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "70AD47" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      }
      
      XLSX.utils.book_append_sheet(wb, wsCompanySummary, 'Company Summary');

      // Client summary sheet with improved formatting
      const clientSummary = clients.map(client => {
        const clientChecks = dataToExport.filter(check => 
          check.clientId === client.id || 
          check.relationshipDetails?.some(rel => rel.clientId === client.id)
        );
        const totalAmount = clientChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
        const totalChecks = clientChecks.length;
        
        return {
          'Client': client.name,
          'Company': companies.find(c => c.id === clientChecks[0]?.companyId)?.name || 'Unknown',
          'Total Checks': totalChecks,
          'Total Amount': totalAmount,
          'Active': client.active ? 'Yes' : 'No'
        };
      });
      const wsClientSummary = XLSX.utils.json_to_sheet(clientSummary);
      
      // Set column widths for client summary
      wsClientSummary['!cols'] = [
        { wch: 25 }, // Client
        { wch: 25 }, // Company
        { wch: 15 }, // Total Checks
        { wch: 18 }, // Total Amount
        { wch: 10 }  // Active
      ];
      
      // Add header styling
      const clientRange = XLSX.utils.decode_range(wsClientSummary['!ref'] || 'A1');
      for (let C = clientRange.s.c; C <= clientRange.e.c; ++C) {
        const address = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!wsClientSummary[address]) continue;
        wsClientSummary[address].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "ED7D31" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      }
      
      XLSX.utils.book_append_sheet(wb, wsClientSummary, 'Client Summary');

      // Employee summary sheet with improved formatting
      const employeeSummary = employees.map(employee => {
        const employeeChecks = dataToExport.filter(check => check.employeeId === employee.id);
        const totalAmount = employeeChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
        const totalChecks = employeeChecks.length;
        
        return {
          'Employee': employee.name,
          'Company': companies.find(c => c.id === employee.companyId)?.name || 'Unknown',
          'Total Checks': totalChecks,
          'Total Amount': totalAmount,
          'Active': employee.active ? 'Yes' : 'No'
        };
      });
      const wsEmployeeSummary = XLSX.utils.json_to_sheet(employeeSummary);
      
      // Set column widths for employee summary
      wsEmployeeSummary['!cols'] = [
        { wch: 25 }, // Employee
        { wch: 25 }, // Company
        { wch: 15 }, // Total Checks
        { wch: 18 }, // Total Amount
        { wch: 10 }  // Active
      ];
      
      // Add header styling
      const employeeRange = XLSX.utils.decode_range(wsEmployeeSummary['!ref'] || 'A1');
      for (let C = employeeRange.s.c; C <= employeeRange.e.c; ++C) {
        const address = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!wsEmployeeSummary[address]) continue;
        wsEmployeeSummary[address].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "A5A5A5" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      }
      
      XLSX.utils.book_append_sheet(wb, wsEmployeeSummary, 'Employee Summary');

      // Export the file
      XLSX.writeFile(wb, filename);
      
      const companyName = companyId ? companies.find(c => c.id === companyId)?.name : 'All Companies';
      setSuccess(`${companyName} report exported successfully! ${dataToExport.length} checks included.`);
      
    } catch (err) {
      console.error('Error exporting report:', err);
      setError('Failed to export report. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const filteredChecks = getFilteredData();
  const totalAmount = filteredChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
  const companyReports = generateCompanyReports();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
          Check Reports & Analytics
      </Typography>
      
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Export comprehensive check information to Excel with detailed breakdowns by company, client, and employee.
      </Typography>

      {/* Filters */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          <FilterList sx={{ mr: 1, verticalAlign: 'middle' }} />
          Report Filters
        </Typography>
        
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 3 }}>
          <Box>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={filters.companyId || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, companyId: e.target.value || undefined }))}
                label="Company"
              >
                <MenuItem value="">All Companies</MenuItem>
                {companies.map(company => (
                  <MenuItem key={company.id} value={company.id}>
                    {company.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          
          <Box>
            <TextField
              fullWidth
              type="date"
              label="Start Date"
              value={filters.startDate || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          
          <Box>
            <TextField
              fullWidth
              type="date"
              label="End Date"
              value={filters.endDate || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          
          <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={filters.includeInactive}
                    onChange={(e) => setFilters(prev => ({ ...prev, includeInactive: e.target.checked }))}
                  />
                }
                label="Include Inactive"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={filters.includeUnpaid}
                    onChange={(e) => setFilters(prev => ({ ...prev, includeUnpaid: e.target.checked }))}
                  />
                }
                label="Include Unpaid"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={filters.includeUnreviewed}
                    onChange={(e) => setFilters(prev => ({ ...prev, includeUnreviewed: e.target.checked }))}
                  />
                }
                label="Include Unreviewed"
              />
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Summary Stats */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          📈 Summary Statistics
        </Typography>
        
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 3 }}>
          <Box textAlign="center">
            <Typography variant="h4" color="primary" fontWeight="bold">
              {filteredChecks.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Checks
            </Typography>
          </Box>
          
          <Box textAlign="center">
            <Typography variant="h4" color="success.main" fontWeight="bold">
              ${totalAmount.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Amount
            </Typography>
          </Box>
          
          <Box textAlign="center">
            <Typography variant="h4" color="info.main" fontWeight="bold">
              {companies.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Companies
            </Typography>
          </Box>
          
          <Box textAlign="center">
            <Typography variant="h4" color="warning.main" fontWeight="bold">
              {employees.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Employees
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Tabs for different views */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Tabs value={selectedTab} onChange={(e, newValue) => setSelectedTab(newValue)} sx={{ mb: 3 }}>
          <Tab 
            icon={<Business />} 
            label="Company Reports" 
            iconPosition="start"
          />
          <Tab 
            icon={<AttachMoney />} 
            label="Client Breakdown" 
            iconPosition="start"
          />
          <Tab 
            icon={<People />} 
            label="Employee Summary" 
            iconPosition="start"
          />
        </Tabs>

        {/* Company Reports Tab */}
        {selectedTab === 0 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Company Reports
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="large"
                startIcon={exporting ? <CircularProgress size={20} /> : <Download />}
                onClick={() => exportToExcel()}
                disabled={exporting || filteredChecks.length === 0}
              >
                {exporting ? 'Exporting...' : 'Export All Clients'}
              </Button>
              
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={fetchData}
                disabled={loading}
              >
                Refresh Data
              </Button>
            </Box>

            {companyReports.map((report) => (
              <Accordion 
                key={report.company.id}
                expanded={expandedCompany === report.company.id}
                onChange={() => setExpandedCompany(expandedCompany === report.company.id ? null : report.company.id)}
                sx={{ mb: 2 }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pr: 2 }}>
                    <Box>
                      <Typography variant="h6" fontWeight="bold">
                        {report.company.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {report.totalChecks} checks • ${report.totalAmount.toLocaleString()}
                      </Typography>
                    </Box>
                  </Box>
                </AccordionSummary>
                
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 2, py: 1 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => exportToExcel(report.company.id)}
                    disabled={exporting}
                  >
                    Export Company
                  </Button>
                </Box>
                
                <AccordionDetails>
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                      Client Breakdown
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow key="company-reports-header">
                            <TableCell>Client</TableCell>
                            <TableCell align="right">Checks</TableCell>
                            <TableCell align="right">Hourly Amount</TableCell>
                            <TableCell align="right">Per Diem Amount</TableCell>
                            <TableCell align="right">Total Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(() => {
                            console.log('🔍 DEBUG: Rendering company reports TableBody, clientBreakdown:', report.clientBreakdown);
                            const validClients = report.clientBreakdown.filter(client => client.clientId && client.clientId !== 'null' && client.clientId !== 'undefined');
                            console.log('🔍 DEBUG: Filtered to valid clients:', validClients.length, 'out of', report.clientBreakdown.length);
                            return null;
                          })()}
                          {report.clientBreakdown
                            .filter(client => client.clientId && client.clientId !== 'null' && client.clientId !== 'undefined')
                            .map((client) => {
                              console.log('🔍 DEBUG: Rendering client row:', client.clientId, client.clientName);
                              return (
                                <TableRow key={client.clientId}>
                                  <TableCell>{client.clientName}</TableCell>
                                  <TableCell align="right">{client.totalChecks}</TableCell>
                                  <TableCell align="right">${client.hourlyAmount.toLocaleString()}</TableCell>
                                  <TableCell align="right">${client.perdiemAmount.toLocaleString()}</TableCell>
                                  <TableCell align="right">${client.totalAmount.toLocaleString()}</TableCell>
                                </TableRow>
                              );
                            })}
                          
                          {/* Total Row for Company Reports */}
                          <TableRow key={`total-${report.company.id}`} sx={{ backgroundColor: '#f5f5f5', fontWeight: 'bold' }}>
                            <TableCell><strong>TOTAL</strong></TableCell>
                            <TableCell align="right">
                              <strong>
                                {report.clientBreakdown.reduce((sum, client) => sum + client.totalChecks, 0)}
                              </strong>
                            </TableCell>
                            <TableCell align="right">
                              <strong>
                                ${report.clientBreakdown.reduce((sum, client) => sum + client.hourlyAmount, 0).toLocaleString()}
                              </strong>
                            </TableCell>
                            <TableCell align="right">
                              <strong>
                                ${report.clientBreakdown.reduce((sum, client) => sum + client.perdiemAmount, 0).toLocaleString()}
                              </strong>
                            </TableCell>
                            <TableCell align="right">
                              <strong>
                                ${report.clientBreakdown.reduce((sum, client) => sum + client.totalAmount, 0).toLocaleString()}
                              </strong>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}

        {/* Client Breakdown Tab - Fixed React warnings */}
        {selectedTab === 1 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              💰 Client Breakdown
            </Typography>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow key="client-breakdown-header">
                    <TableCell>Client</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell align="right">Total Checks</TableCell>
                    <TableCell align="right">Total Amount</TableCell>
                    <TableCell align="right">Hourly Amount</TableCell>
                    <TableCell align="right">Per Diem Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(() => {
                    console.log('🔍 DEBUG: Rendering client breakdown TableBody, clients:', clients);
                    return null;
                  })()}
                  {clients.map((client) => {
                    console.log('🔍 DEBUG: Processing client:', client.id, client.name);
                    const clientChecks = filteredChecks.filter(check => 
                      check.clientId === client.id || 
                      check.relationshipDetails?.some(rel => rel.clientId === client.id)
                    );
                    
                    if (clientChecks.length === 0) {
                      console.log('🔍 DEBUG: Client has no checks, returning null:', client.id);
                      return null;
                    }
                    
                    const totalAmount = clientChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
                    const totalChecks = clientChecks.length;
                    
                    // Calculate hourly vs per diem amounts
                    let hourlyAmount = 0;
                    let perdiemAmount = 0;
                    
                    clientChecks.forEach(check => {
                      if (check.payType === 'hourly' || check.payType === 'mixed') {
                        const hourlyTotal = (check.hours || 0) * (check.payRate || 0) +
                                           (check.overtimeHours || 0) * (check.overtimeRate || 0) +
                                           (check.holidayHours || 0) * (check.holidayRate || 0);
                        hourlyAmount += hourlyTotal;
                      }
                      
                      if (check.payType === 'perdiem' || check.payType === 'mixed') {
                        let perdiemTotal = check.perdiemAmount || 0;
                        if (check.perdiemBreakdown) {
                          perdiemTotal = (check.perdiemMonday || 0) + 
                                        (check.perdiemTuesday || 0) + 
                                        (check.perdiemWednesday || 0) + 
                                        (check.perdiemThursday || 0) + 
                                        (check.perdiemFriday || 0) + 
                                        (check.perdiemSaturday || 0) + 
                                        (check.perdiemSunday || 0);
                        }
                        perdiemAmount += perdiemTotal;
                      }
                    });

                    const company = companies.find(c => c.id === clientChecks[0]?.companyId);
                    
                    return (
                      <TableRow key={client.id}>
                        <TableCell>{client.name}</TableCell>
                        <TableCell>{company?.name || 'Unknown'}</TableCell>
                        <TableCell align="right">{totalChecks}</TableCell>
                        <TableCell align="right">${totalAmount.toLocaleString()}</TableCell>
                        <TableCell align="right">${hourlyAmount.toLocaleString()}</TableCell>
                        <TableCell align="right">${perdiemAmount.toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })
                    .filter(Boolean)}
                  
                  {/* Total Row */}
                  <TableRow key="client-breakdown-total" sx={{ backgroundColor: '#f5f5f5', fontWeight: 'bold' }}>
                    <TableCell><strong>TOTAL</strong></TableCell>
                    <TableCell></TableCell>
                    <TableCell align="right">
                      <strong>
                        {clients.reduce((sum, client) => {
                          const clientChecks = filteredChecks.filter(check => 
                            check.clientId === client.id || 
                            check.relationshipDetails?.some(rel => rel.clientId === client.id)
                          );
                          return sum + clientChecks.length;
                        }, 0)}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        ${filteredChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0).toLocaleString()}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        ${filteredChecks.reduce((sum, check) => {
                          if (check.payType === 'hourly' || check.payType === 'mixed') {
                            const hourlyTotal = (check.hours || 0) * (check.payRate || 0) +
                                               (check.overtimeHours || 0) * (check.overtimeRate || 0) +
                                               (check.holidayHours || 0) * (check.holidayRate || 0);
                            return sum + hourlyTotal;
                          }
                          return sum;
                        }, 0).toLocaleString()}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        ${filteredChecks.reduce((sum, check) => {
                          if (check.payType === 'perdiem' || check.payType === 'mixed') {
                            let perdiemTotal = check.perdiemAmount || 0;
                            if (check.perdiemBreakdown) {
                              perdiemTotal = (check.perdiemMonday || 0) + 
                                            (check.perdiemTuesday || 0) + 
                                            (check.perdiemWednesday || 0) + 
                                            (check.perdiemThursday || 0) + 
                                            (check.perdiemFriday || 0) + 
                                            (check.perdiemSaturday || 0) + 
                                            (check.perdiemSunday || 0);
                            }
                            return sum + perdiemTotal;
                          }
                          return sum;
                        }, 0).toLocaleString()}
                      </strong>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Employee Summary Tab - Fixed React warnings */}
        {selectedTab === 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Employee Summary
            </Typography>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow key="employee-summary-header">
                    <TableCell>Employee</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell align="right">Total Checks</TableCell>
                    <TableCell align="right">Total Amount</TableCell>
                    <TableCell align="right">Average per Check</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {employees
                    .map((employee) => {
                      const employeeChecks = filteredChecks.filter(check => check.employeeId === employee.id);
                      
                      if (employeeChecks.length === 0) return null;
                      
                      const totalAmount = employeeChecks.reduce((sum, check) => sum + parseFloat(check.amount?.toString() || '0'), 0);
                      const totalChecks = employeeChecks.length;
                      const averagePerCheck = totalChecks > 0 ? totalAmount / totalChecks : 0;
                      
                      const company = companies.find(c => c.id === employee.companyId);
                      
                      return (
                        <TableRow key={employee.id}>
                          <TableCell>{employee.name}</TableCell>
                          <TableCell>{company?.name || 'Unknown'}</TableCell>
                          <TableCell align="right">{totalChecks}</TableCell>
                          <TableCell align="right">${totalAmount.toLocaleString()}</TableCell>
                          <TableCell align="right">${averagePerCheck.toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })
                    .filter(Boolean)}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Paper>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
    </Box>
  );
};

export default Report; 