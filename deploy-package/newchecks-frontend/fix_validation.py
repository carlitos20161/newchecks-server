import re

# Read the file
with open('src/components/checks.tsx', 'r') as f:
    content = f.read()

# Find and replace the validation logic for Multiple Clients
lines = content.split('\n')
new_lines = []

i = 0
while i < len(lines):
    line = lines[i]
    
    # Look for the fallback validation logic
    if '// Fallback to basic fields if no relationship data found' in line and 'if (!hasHourlyData && !hasPerDiemData) {' in lines[i+1]:
        # Add the new logic for Multiple Clients
        new_lines.append('        // Fallback to basic fields if no relationship data found')
        new_lines.append('        if (!hasHourlyData && !hasPerDiemData) {')
        new_lines.append('          // For Multiple Clients tab, check relationship-specific fields')
        new_lines.append('          if (selectedClientId === \'multiple\' && emp.clientPayTypeRelationships) {')
        new_lines.append('            emp.clientPayTypeRelationships.forEach(relationship => {')
        new_lines.append('              if (relationship.payType === \'hourly\') {')
        new_lines.append('                const relHours = parseFloat(data[`${relationship.id}_hours`] || \'0\');')
        new_lines.append('                const relOtHours = parseFloat(data[`${relationship.id}_otHours`] || \'0\');')
        new_lines.append('                const relHolidayHours = parseFloat(data[`${relationship.id}_holidayHours`] || \'0\');')
        new_lines.append('                if (relHours > 0 || relOtHours > 0 || relHolidayHours > 0) {')
        new_lines.append('                  hasHourlyData = true;')
        new_lines.append('                }')
        new_lines.append('              } else if (relationship.payType === \'perdiem\') {')
        new_lines.append('                const relAmount = parseFloat(data[`${relationship.id}_perdiemAmount`] || \'0\');')
        new_lines.append('                const relBreakdown = data[`${relationship.id}_perdiemBreakdown`];')
        new_lines.append('                if (relBreakdown) {')
        new_lines.append('                  const hasDailyData = [\'perdiemMonday\', \'perdiemTuesday\', \'perdiemWednesday\',')
        new_lines.append('                                       \'perdiemThursday\', \'perdiemFriday\', \'perdiemSaturday\', \'perdiemSunday\']')
        new_lines.append('                    .some(day => parseFloat(data[`${relationship.id}_${day}`] || \'0\') > 0);')
        new_lines.append('                  if (hasDailyData) {')
        new_lines.append('                    hasPerDiemData = true;')
        new_lines.append('                  }')
        new_lines.append('                } else if (relAmount > 0) {')
        new_lines.append('                  hasPerDiemData = true;')
        new_lines.append('                }')
        new_lines.append('              }')
        new_lines.append('            });')
        new_lines.append('          }')
        new_lines.append('          ')
        new_lines.append('          // Check basic per diem fields if still no data found')
        new_lines.append('          if (!hasPerDiemData) {')
        new_lines.append('            hasPerDiemData = parseFloat(calculatePerDiemTotal(data)) > 0;')
        new_lines.append('          }')
        new_lines.append('          ')
        new_lines.append('          // Check basic hourly fields if still no data found')
        new_lines.append('          if (!hasHourlyData) {')
        new_lines.append('            hasHourlyData = parseFloat(data.hours || \'0\') > 0 ||')
        new_lines.append('                           parseFloat(data.otHours || \'0\') > 0 ||')
        new_lines.append('                           parseFloat(data.holidayHours || \'0\') > 0;')
        new_lines.append('          }')
        new_lines.append('        }')
        i += 3  # Skip the original lines
    else:
        new_lines.append(line)
        i += 1

# Write the file back
with open('src/components/checks.tsx', 'w') as f:
    f.write('\n'.join(new_lines))

print("Validation logic fixed for Multiple Clients tab!")
