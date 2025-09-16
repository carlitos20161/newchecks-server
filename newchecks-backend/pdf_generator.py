from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from io import BytesIO
import base64
import os
from num2words import num2words

# === MICR Font Registration ===
micr_font_path = os.path.join(os.path.dirname(__file__), "CovixMICRU copy.ttf")
MICR_REGISTERED = False
if os.path.exists(micr_font_path):
    try:
        pdfmetrics.registerFont(TTFont("MICR", micr_font_path))
        MICR_REGISTERED = True
    except Exception as e:
        print("⚠️ Failed to register MICR font:", e)

def generate_clean_check(check):
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    section_height = height / 3

    def draw_section(y_offset, top_section=False, middle_section=False, bottom_section=False):
        top = y_offset + section_height - 0.40 * inch
        left = 0.75 * inch
        right = 7.75 * inch

        if top_section:
            # === Company Logo + Name & Address ===
            logo_width = 60
            logo_height = 60
            text_x = left + logo_width + 10
            text_y = top - logo_height / 2 + 10

            if check.company.logo:
                try:
                    print(f"🖼️ Attempting to load logo for {check.company.name}")
                    print(f"📏 Logo data length: {len(check.company.logo)}")
                    
                    # Check if logo data looks like base64
                    if not check.company.logo.startswith('data:image/'):
                        # Assume it's raw base64
                        logo_data = base64.b64decode(check.company.logo)
                    else:
                        # Handle data URL format
                        import re
                        match = re.match(r'data:image/(\w+);base64,(.+)', check.company.logo)
                        if match:
                            logo_data = base64.b64decode(match.group(2))
                        else:
                            raise ValueError("Invalid data URL format")
                    
                    logo_image = ImageReader(BytesIO(logo_data))
                    print(f"✅ Logo loaded successfully, dimensions: {logo_image.getSize()}")
                    
                    c.drawImage(logo_image, left, top - logo_height + 10, width=logo_width, height=logo_height, mask='auto')
                    c.setFont("Helvetica-Bold", 10)
                    c.drawString(text_x, text_y, check.company.name)
                    c.setFont("Helvetica", 8)
                    c.drawString(text_x, text_y - 14, check.company.address or "")
                except Exception as e:
                    print(f"❌ Logo error for {check.company.name}: {str(e)}")
                    c.setFont("Helvetica-Bold", 10)
                    c.drawString(left, top, check.company.name)
                    c.setFont("Helvetica", 8)
                    c.drawString(left, top - 14, check.company.address or "")
            else:
                c.setFont("Helvetica-Bold", 10)
                c.drawString(left, top, check.company.name)
                c.setFont("Helvetica", 8)
                c.drawString(left, top - 14, check.company.address or "")

            # === Bank and Check Number ===
            c.setFont("Helvetica-Bold", 11)
            c.drawString(4.5 * inch, top, check.bank.name)
            c.drawRightString(right, top, str(check.check_number))

            # === Date & VOID ===
            c.setFont("Helvetica", 10)
            c.drawString(6.2 * inch, top - 35, "DATE")
            date_str = check.date.strftime("%m/%d/%Y") if check.date else "N/A"
            c.drawRightString(right, top - 35, date_str)
            c.line(6.9 * inch, top - 37, right, top - 37)

            # === ISO Week ===
            # Use work_week if available, otherwise calculate from date
            if hasattr(check, 'work_week') and check.work_week:
                week_label = check.work_week
            else:
                iso_year, iso_week, _ = check.date.isocalendar()
                week_label = f"Work Week {iso_week:02}"
            c.setFont("Helvetica-Oblique", 9)
            c.drawRightString(right, top - 50, week_label)

            

            # === Payee and Amount ===
            # "PAY TO THE" on top line
            c.setFont("Helvetica-Bold", 9)
            c.drawString(left, top - 60, "PAY TO THE")

            # "ORDER OF" below it
            c.drawString(left, top - 72, "ORDER OF")

            # Payee name on same horizontal line as "ORDER OF"
            c.setFont("Helvetica", 11)
            c.drawString(left + 100, top - 72, check.employee.name)

            # Line under payee name
            c.line(left + 95, top - 74, 5.2 * inch, top - 74)

            

            # === Amount Box with Dollar Sign ===
            c.setFont("Helvetica-Bold", 12)

            # === Amount Box aligned with date line ===
            amount_box_width = 1.2 * inch
            amount_box_right = right  # 7.75 * inch
            amount_box_left = amount_box_right - amount_box_width

            # Dollar sign just left of the box
            c.drawString(amount_box_left - 0.15 * inch, top - 71, "$")

            # Draw the rectangle for the amount
            c.rect(amount_box_left, top - 76, amount_box_width, 20)

            # Draw the amount inside the box
            c.drawCentredString(amount_box_left + amount_box_width / 2, top - 71, f"*** {check.amount:,.2f}")




            c.setFont("Helvetica", 10)

            # Format amount in words (exclude "dollars")
            amount_words = num2words(check.amount, to='currency', lang='en').replace("euro", "").replace(",", "").capitalize().strip()


            text_y = top - 100
            text_x = left

            # Position where "dollars" should end
            dollars_text = "DOLLARS"
            dollars_width = c.stringWidth(dollars_text, "Helvetica", 10)
            dollars_x = 7.45 * inch  # Adjust this to match where the box normally ends

            # Draw the amount in words
            c.drawString(text_x, text_y, amount_words)

            # Width of written words
            words_width = c.stringWidth(amount_words + " ", "Helvetica", 10)
            dash_start = text_x + words_width
            dash_end = dollars_x - dollars_width - 6

            # Number of dashes between
            dash_width = c.stringWidth("-", "Helvetica", 10)
            num_dashes = int((dash_end - dash_start) / dash_width)

            # Draw a line ending right before "DOLLARS"
            c.line(left, top - 102, dollars_x - dollars_width - 6, top - 102)


            # Draw filler dashes
            c.drawString(dash_start, text_y, "-" * num_dashes)

            # Draw "dollars" aligned near right
            c.drawString(dollars_x - dollars_width, text_y, dollars_text)





            # Draw employee name (under the amount words line)
            c.setFont("Helvetica", 9)
            c.drawString(left, top - 113, check.employee.name)
            c.drawRightString(right, top - 113, "VOID AFTER 90 DAYS")


            # === Memo and Signature ===
            memo_label = "MEMO:"
            # Use the actual memo from the check
            if check.memo:
                memo_value =  check.work_week
            elif check.client:
                memo_value = f"Work for {check.client.name}"
            else:
                # Fallback to empty if no memo
                memo_value = check.work_week

            c.setFont("Helvetica", 10)
            
            # Use a shared y-position for both memo and signature
            memo_and_signature_y = top - 150

            # === Memo ===
            c.setFont("Helvetica", 10)
            c.drawString(left, memo_and_signature_y, memo_label)

            memo_value_x = left + c.stringWidth(memo_label + " ", "Helvetica", 10)
            c.drawString(memo_value_x, memo_and_signature_y, memo_value)

            line_end_x = memo_value_x + c.stringWidth(memo_value, "Helvetica", 10) + 20
            c.line(memo_value_x, memo_and_signature_y - 2, line_end_x, memo_and_signature_y - 2)

            # === Authorized Signature (same height as memo)
            signature_line_y = memo_and_signature_y - 2
            signature_x_start = right - 2.5 * inch
            signature_x_end = right
            c.line(signature_x_start, signature_line_y, signature_x_end, signature_line_y)
            c.setFont("Helvetica", 8)
            c.drawString(signature_x_start, signature_line_y - 10, "AUTHORIZED SIGNATURE")





            c.setFont("Helvetica", 8)
            c.drawString(signature_x_start, signature_line_y - 10, "AUTHORIZED SIGNATURE")


            # === MICR Line ===
            if MICR_REGISTERED:
                c.setFont("MICR", 10)
            else:
                c.setFont("Courier-Bold", 10)
            micr = f"⑈{check.check_number:0>6}⑈ ⑆{check.bank.routing_number}⑆ ⑇{check.bank.account_number}⑇"
            c.drawCentredString(width / 2, y_offset + 0.45 * inch, micr)

        if middle_section:
            y = top
            c.setFont("Helvetica-Bold", 10)
            c.drawString(left, y, check.employee.name)
            
            # Show client information from relationships or single client
            if hasattr(check, 'relationshipDetails') and check.relationshipDetails:
                # Multiple relationships - show combined client names with better formatting
                client_names = [rel.get('clientName', 'Unknown') for rel in check.relationshipDetails if rel.get('clientName')]
                if client_names:
                    c.setFont("Helvetica-Bold", 7)  # Smaller font for compact display
                    # Use singular "Client:" for single, "Clients:" for multiple
                    prefix = "Client:" if len(client_names) == 1 else "Clients:"
                    
                    # Format client names with payment types for better clarity
                    client_details = []
                    for rel in check.relationshipDetails:
                        if rel.get('clientName'):
                            pay_type = rel.get('payType', 'Unknown')
                            pay_type_display = "H" if pay_type == "hourly" else "PD" if pay_type == "perdiem" else pay_type
                            client_details.append(f"{rel.get('clientName')} ({pay_type_display})")
                    
                    # Join with line breaks for better readability
                    client_text = f"{prefix} " + " | ".join(client_details)
                    
                    # Position further left and use more space
                    c.drawString(left + 200, y, client_text)
            elif check.client:
                # Single client (legacy)
                c.setFont("Helvetica-Bold", 7)
                c.drawString(left + 200, y, f"Client: {check.client.name}")
            y -= 16  # Back to original spacing for compact layout

            # === Memo in middle section ===
            if check.memo:
                c.setFont("Helvetica-Bold", 12)
                c.drawString(left, y, f"Memo: {check.memo}")
                y -= 12


            c.setFont("Helvetica-Bold", 9)
            c.drawString(left, y, "Description")
            c.drawRightString(5.5 * inch, y, "Amount")
            y -= 12
            c.setFont("Helvetica", 9)

            has_breakdown = False

            # Only show generic hours if NO relationship details are available
            if not hasattr(check, 'relationshipDetails') or not check.relationshipDetails:
                if check.hours_worked and check.pay_rate:
                    hours_worked = float(str(check.hours_worked))
                    pay_rate = float(str(check.pay_rate))
                    c.drawString(left, y, f"Regular Hours ({hours_worked} × ${pay_rate:.2f})")
                    c.drawRightString(5.5 * inch, y, f"${hours_worked * pay_rate:.2f}")
                    y -= 12

            if check.overtime_hours and check.overtime_rate:
                overtime_hours = float(str(check.overtime_hours))
                overtime_rate = float(str(check.overtime_rate))
                c.drawString(left, y, f"Overtime Hours ({overtime_hours} × ${overtime_rate:.2f})")
                c.drawRightString(5.5 * inch, y, f"${overtime_hours * overtime_rate:.2f}")
                y -= 12

            if check.holiday_hours and check.holiday_rate:
                holiday_hours = float(str(check.holiday_hours))
                holiday_rate = float(str(check.holiday_rate))
                c.drawString(left, y, f"Holiday Hours ({holiday_hours} × ${holiday_rate:.2f})")
                c.drawRightString(5.5 * inch, y, f"${holiday_hours * holiday_rate:.2f}")
                y -= 12

            # ✅ Add per diem amount to breakdown (STANDALONE - not inside holiday block)
            # Only show generic per diem if NO relationship details are available
            if not hasattr(check, 'relationshipDetails') or not check.relationshipDetails:
                perdiem_total = 0
                if hasattr(check, 'perdiem_breakdown') and check.perdiem_breakdown:
                    # Calculate from daily breakdown - convert strings to floats
                    perdiem_total = (
                        float(getattr(check, 'perdiem_monday', 0) or 0) + 
                        float(getattr(check, 'perdiem_tuesday', 0) or 0) + 
                        float(getattr(check, 'perdiem_wednesday', 0) or 0) + 
                        float(getattr(check, 'perdiem_thursday', 0) or 0) + 
                        float(getattr(check, 'perdiem_friday', 0) or 0) + 
                        float(getattr(check, 'perdiem_saturday', 0) or 0) + 
                        float(getattr(check, 'perdiem_sunday', 0) or 0)
                    )
                else:
                    perdiem_total = float(getattr(check, 'perdiem_amount', 0) or 0)
                
                if perdiem_total > 0:
                    c.drawString(left, y, f"Per Diem Amount")
                    c.drawRightString(5.5 * inch, y, f"${perdiem_total:.2f}")
                    y -= 12
                    
                    # Add daily breakdown if using breakdown mode
                    if hasattr(check, 'perdiem_breakdown') and check.perdiem_breakdown:
                        c.setFont("Helvetica", 8)
                        daily_amounts = [
                            ('Monday', getattr(check, 'perdiem_monday', 0)),
                            ('Tuesday', getattr(check, 'perdiem_tuesday', 0)),
                            ('Wednesday', getattr(check, 'perdiem_wednesday', 0)),
                            ('Thursday', getattr(check, 'perdiem_thursday', 0)),
                            ('Friday', getattr(check, 'perdiem_friday', 0)),
                            ('Saturday', getattr(check, 'perdiem_saturday', 0)),
                            ('Sunday', getattr(check, 'perdiem_sunday', 0))
                        ]
                        
                        for day, amount in daily_amounts:
                            if amount and amount > 0:
                                c.drawString(left + 12, y, f"• {day}: ${amount:.2f}")
                                y -= 10
                        
                        c.setFont("Helvetica", 9)
                        y -= 2

            # Add relationship breakdown if available
            # DEBUG: Print relationship data
            print(f"🔍 PDF DEBUG: check.relationshipDetails: {getattr(check, 'relationshipDetails', 'NOT_FOUND')}")
            print(f"🔍 PDF DEBUG: check.hours_worked: {getattr(check, 'hours_worked', 'NOT_FOUND')}")
            print(f"🔍 PDF DEBUG: check.pay_rate: {getattr(check, 'pay_rate', 'NOT_FOUND')}")
            print(f"🔍 PDF DEBUG: ALL check attributes: {[attr for attr in dir(check) if not attr.startswith('_')]}")
            print(f"🔍 PDF DEBUG: check.relationshipHours: {getattr(check, 'relationshipHours', 'NOT_FOUND')}")
            
            if hasattr(check, 'relationshipDetails') and check.relationshipDetails and not has_breakdown:
                has_breakdown = True
                print(f"🔍 PDF DEBUG: Processing {len(check.relationshipDetails)} relationships")
                
                for rel in check.relationshipDetails:
                    print(f"🔍 PDF DEBUG: Processing relationship: {rel}")
                    if rel.get('payType') == 'hourly':
                        # Use actual relationship hours if available
                        pay_rate = rel.get('payRate', 0)
                        relationship_id = rel.get('id')
                        
                        # Try to get actual hours from relationship-specific fields first
                        actual_hours = 0
                        print(f"🔍 PDF DEBUG: Checking relationshipHours for {relationship_id}")
                        print(f"🔍 PDF DEBUG: check.relationshipHours: {getattr(check, 'relationshipHours', 'NOT_FOUND')}")
                        print(f"🔍 PDF DEBUG: relationship_id: {relationship_id}")
                        
                        # First try relationship-specific field (e.g., "1754920623462_hours")
                        rel_hours_field = f"{relationship_id}_hours"
                        if hasattr(check, rel_hours_field):
                            actual_hours = getattr(check, rel_hours_field, 0)
                            print(f"🔍 PDF DEBUG: Found relationship-specific hours in {rel_hours_field}: {actual_hours}")
                        # Fallback to relationshipHours dict
                        elif hasattr(check, 'relationshipHours') and check.relationshipHours and relationship_id:
                            actual_hours = check.relationshipHours.get(relationship_id, 0)
                            print(f"🔍 PDF DEBUG: Found actual_hours from relationshipHours: {actual_hours}")
                        else:
                            print(f"🔍 PDF DEBUG: No relationship hours found, using fallback")
                        
                        if pay_rate > 0 and actual_hours > 0:
                            amount = actual_hours * pay_rate
                            print(f"🔍 PDF DEBUG: Using ACTUAL hours: {actual_hours} × ${pay_rate:.2f} = ${amount:.2f}")
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Regular Hours ({actual_hours} × ${pay_rate:.2f})")
                            c.drawRightString(5.5 * inch, y, f"${amount:.2f}")
                            y -= 12
                        elif pay_rate > 0:
                            # Fallback for old checks without relationshipHours
                            estimated_hours = 20
                            amount = estimated_hours * pay_rate
                            print(f"🔍 PDF DEBUG: Using FALLBACK hours: {estimated_hours} × ${pay_rate:.2f} = ${amount:.2f}")
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Regular Hours ({estimated_hours} × ${pay_rate:.2f})")
                            c.drawRightString(5.5 * inch, y, f"${amount:.2f}")
                            y -= 12
                    elif rel.get('payType') == 'perdiem':
                        # For per diem relationships, show actual daily breakdown if available
                        relationship_id = rel.get('id')
                        print(f"🔍 PDF DEBUG: Processing per diem relationship: {rel.get('clientName')}")
                        print(f"🔍 PDF DEBUG: relationship_id: {relationship_id}")
                        
                        # Try relationship-specific per diem fields first
                        rel_perdiem_amount_field = f"{relationship_id}_perdiemAmount"
                        rel_perdiem_breakdown_field = f"{relationship_id}_perdiemBreakdown"
                        
                        perdiem_amount = 0
                        perdiem_breakdown = False
                        
                        # Check for relationship-specific per diem amount
                        if hasattr(check, rel_perdiem_amount_field):
                            perdiem_amount = float(getattr(check, rel_perdiem_amount_field, 0) or 0)
                            print(f"🔍 PDF DEBUG: Found relationship-specific per diem amount: {perdiem_amount}")
                        else:
                            # Fallback to general per diem amount
                            perdiem_amount = float(getattr(check, 'perdiem_amount', 0) or 0)
                            print(f"🔍 PDF DEBUG: Using general per diem amount: {perdiem_amount}")
                        
                        # Check for relationship-specific breakdown flag
                        if hasattr(check, rel_perdiem_breakdown_field):
                            perdiem_breakdown = getattr(check, rel_perdiem_breakdown_field, False)
                            print(f"🔍 PDF DEBUG: Found relationship-specific breakdown flag: {perdiem_breakdown}")
                        else:
                            # Fallback to general breakdown flag
                            perdiem_breakdown = getattr(check, 'perdiem_breakdown', False)
                            print(f"🔍 PDF DEBUG: Using general breakdown flag: {perdiem_breakdown}")
                        
                        if perdiem_breakdown:
                            # Try to get relationship-specific daily amounts
                            daily_total = 0
                            daily_amounts = []
                            
                            for day in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
                                rel_day_field = f"{relationship_id}_perdiem{day.capitalize()}"
                                if hasattr(check, rel_day_field):
                                    amount = float(getattr(check, rel_day_field, 0) or 0)
                                else:
                                    amount = float(getattr(check, f'perdiem_{day}', 0) or 0)
                                
                                if amount > 0:
                                    daily_amounts.append((day.capitalize(), amount))
                                    daily_total += amount
                            
                            print(f"🔍 PDF DEBUG: Daily breakdown total: ${daily_total:.2f}")
                            
                            if daily_total > 0:
                                c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Per Diem")
                                c.drawRightString(5.5 * inch, y, f"${daily_total:.2f}")
                                y -= 12
                                
                                # Add daily breakdown for this relationship
                                c.setFont("Helvetica", 8)
                                for day, amount in daily_amounts:
                                    c.drawString(left + 12, y, f"• {day}: ${amount:.2f}")
                                    y -= 10
                                
                                c.setFont("Helvetica", 9)
                                y -= 2
                        elif perdiem_amount > 0:
                            # Use per diem total amount (no daily breakdown)
                            print(f"🔍 PDF DEBUG: Using per diem total: ${perdiem_amount:.2f}")
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Per Diem")
                            c.drawRightString(5.5 * inch, y, f"${perdiem_amount:.2f}")
                            y -= 12

            if not has_breakdown:
                c.drawString(left, y, "Total Amount")
                c.drawRightString(5.5 * inch, y, f"${check.amount:,.2f}")
                y -= 12
            else:
                # Add total amount for relationship-based checks
                c.drawString(left, y, "Total Amount")
                c.drawRightString(5.5 * inch, y, f"${check.amount:,.2f}")
                y -= 12

        if bottom_section:
            y = top
            c.setFont("Helvetica-Bold", 10)
            c.drawString(left, y, check.employee.name)
            
            # Show client information from relationships or single client
            if hasattr(check, 'relationshipDetails') and check.relationshipDetails:
                # Multiple relationships - show combined client names with better formatting
                client_names = [rel.get('clientName', 'Unknown') for rel in check.relationshipDetails if rel.get('clientName')]
                if client_names:
                    c.setFont("Helvetica-Bold", 7)  # Smaller font for compact display
                    # Use singular "Client:" for single, "Clients:" for multiple
                    prefix = "Client:" if len(client_names) == 1 else "Clients:"
                    
                    # Format client names with payment types for better clarity
                    client_details = []
                    for rel in check.relationshipDetails:
                        if rel.get('clientName'):
                            pay_type = rel.get('payType', 'Unknown')
                            pay_type_display = "H" if pay_type == "hourly" else "PD" if pay_type == "perdiem" else pay_type
                            client_details.append(f"{rel.get('clientName')} ({pay_type_display})")
                    
                    # Join with line breaks for better readability
                    client_text = f"{prefix} " + " | ".join(client_details)
                    
                    # Position further left and use more space
                    c.drawString(left + 200, y, client_text)
            elif check.client:
                # Single client (legacy)
                c.setFont("Helvetica-Bold", 7)
                c.drawString(left + 200, y, f"Client: {check.client.name}")
            y -= 16  # Back to original spacing for compact layout

            c.setFont("Helvetica-Bold", 9)
            c.drawString(left, y, "Description")
            c.drawRightString(5.5 * inch, y, "Amount")
            y -= 12
            c.setFont("Helvetica", 9)

            # Only show generic hours if NO relationship details are available
            if not hasattr(check, 'relationshipDetails') or not check.relationshipDetails:
                if check.hours_worked and check.pay_rate:
                    hours_worked = float(str(check.hours_worked))
                    pay_rate = float(str(check.pay_rate))
                    c.drawString(left, y, f"Regular Hours ({hours_worked} × ${pay_rate:.2f})")
                    c.drawRightString(5.5 * inch, y, f"${hours_worked * pay_rate:.2f}")
                    y -= 12

            if check.overtime_hours and check.overtime_rate:
                overtime_hours = float(str(check.overtime_hours))
                overtime_rate = float(str(check.overtime_rate))
                c.drawString(left, y, f"Overtime Hours ({overtime_hours} × ${overtime_rate:.2f})")
                c.drawRightString(5.5 * inch, y, f"${overtime_hours * overtime_rate:.2f}")
                y -= 12

            if check.holiday_hours and check.holiday_rate:
                holiday_hours = float(str(check.holiday_hours))
                holiday_rate = float(str(check.holiday_rate))
                c.drawString(left, y, f"Holiday Hours ({holiday_hours} × ${holiday_rate:.2f})")
                c.drawRightString(5.5 * inch, y, f"${holiday_hours * holiday_rate:.2f}")
                y -= 12

            # ✅ Add per diem amount to breakdown
            # Only show generic per diem if NO relationship details are available
            if not hasattr(check, 'relationshipDetails') or not check.relationshipDetails:
                perdiem_total = 0
                if hasattr(check, 'perdiem_breakdown') and check.perdiem_breakdown:
                    # Calculate from daily breakdown - convert strings to floats
                    perdiem_total = (
                        float(getattr(check, 'perdiem_monday', 0) or 0) + 
                        float(getattr(check, 'perdiem_tuesday', 0) or 0) + 
                        float(getattr(check, 'perdiem_wednesday', 0) or 0) + 
                        float(getattr(check, 'perdiem_thursday', 0) or 0) + 
                        float(getattr(check, 'perdiem_friday', 0) or 0) + 
                        float(getattr(check, 'perdiem_saturday', 0) or 0) + 
                        float(getattr(check, 'perdiem_sunday', 0) or 0)
                    )
                else:
                    perdiem_total = float(getattr(check, 'perdiem_amount', 0) or 0)
                
                if perdiem_total > 0:
                    c.drawString(left, y, f"Per Diem Amount")
                    c.drawRightString(5.5 * inch, y, f"${perdiem_total:.2f}")
                    y -= 12
                    
                    # Add daily breakdown if using breakdown mode
                    if hasattr(check, 'perdiem_breakdown') and check.perdiem_breakdown:
                        c.setFont("Helvetica", 8)
                        daily_amounts = [
                            ('Monday', getattr(check, 'perdiem_monday', 0)),
                            ('Tuesday', getattr(check, 'perdiem_tuesday', 0)),
                            ('Wednesday', getattr(check, 'perdiem_wednesday', 0)),
                            ('Thursday', getattr(check, 'perdiem_thursday', 0)),
                            ('Friday', getattr(check, 'perdiem_friday', 0)),
                            ('Saturday', getattr(check, 'perdiem_saturday', 0)),
                            ('Sunday', getattr(check, 'perdiem_sunday', 0))
                        ]
                        
                        for day, amount in daily_amounts:
                            if amount and amount > 0:
                                c.drawString(left + 12, y, f"• {day}: ${amount:.2f}")
                                y -= 10
                        
                        c.setFont("Helvetica", 9)
                        y -= 2

            # Add relationship breakdown if available
            if hasattr(check, 'relationshipDetails') and check.relationshipDetails:
                print(f"🔍 PDF DEBUG: Bottom section - Processing {len(check.relationshipDetails)} relationships")
                for rel in check.relationshipDetails:
                    print(f"🔍 PDF DEBUG: Bottom section - Processing relationship: {rel}")
                    print(f"🔍 PDF DEBUG: Bottom section - rel.payType: {rel.get('payType')}")
                    if rel.get('payType') == 'hourly':
                        # For hourly relationships, use actual relationship hours if available
                        pay_rate = rel.get('payRate', 0)
                        relationship_id = rel.get('id')
                        
                        # Try to get actual hours from relationship-specific fields first
                        actual_hours = 0
                        rel_hours_field = f"{relationship_id}_hours"
                        if hasattr(check, rel_hours_field):
                            actual_hours = getattr(check, rel_hours_field, 0)
                        elif hasattr(check, 'relationshipHours') and check.relationshipHours and relationship_id:
                            actual_hours = check.relationshipHours.get(relationship_id, 0)
                        
                        if pay_rate > 0 and actual_hours > 0:
                            amount = actual_hours * pay_rate
                            print(f"🔍 PDF DEBUG: Bottom section - Using ACTUAL hours: {actual_hours} × ${pay_rate:.2f} = ${amount:.2f}")
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Regular Hours ({actual_hours} × ${pay_rate:.2f})")
                            c.drawRightString(5.5 * inch, y, f"${amount:.2f}")
                            y -= 12
                        elif pay_rate > 0:
                            # Fallback for old checks without relationshipHours
                            estimated_hours = 20
                            amount = estimated_hours * pay_rate
                            print(f"🔍 PDF DEBUG: Bottom section - Using FALLBACK hours: {estimated_hours} × ${pay_rate:.2f} = ${amount:.2f}")
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Regular Hours ({estimated_hours} × ${pay_rate:.2f})")
                            c.drawRightString(5.5 * inch, y, f"${amount:.2f}")
                            y -= 12
                    elif rel.get('payType') == 'perdiem':
                        # For per diem relationships, show actual daily breakdown if available
                        relationship_id = rel.get('id')
                        
                        # Try relationship-specific per diem fields first
                        rel_perdiem_amount_field = f"{relationship_id}_perdiemAmount"
                        rel_perdiem_breakdown_field = f"{relationship_id}_perdiemBreakdown"
                        
                        perdiem_amount = 0
                        perdiem_breakdown = False
                        
                        # Check for relationship-specific per diem amount
                        if hasattr(check, rel_perdiem_amount_field):
                            perdiem_amount = float(getattr(check, rel_perdiem_amount_field, 0) or 0)
                        else:
                            perdiem_amount = float(getattr(check, 'perdiem_amount', 0) or 0)
                        
                        # Check for relationship-specific breakdown flag
                        if hasattr(check, rel_perdiem_breakdown_field):
                            perdiem_breakdown = getattr(check, rel_perdiem_breakdown_field, False)
                        else:
                            perdiem_breakdown = getattr(check, 'perdiem_breakdown', False)
                        
                        if perdiem_breakdown:
                            # Try to get relationship-specific daily amounts
                            daily_total = 0
                            daily_amounts = []
                            
                            for day in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
                                rel_day_field = f"{relationship_id}_perdiem{day.capitalize()}"
                                if hasattr(check, rel_day_field):
                                    amount = float(getattr(check, rel_day_field, 0) or 0)
                                else:
                                    amount = float(getattr(check, f'perdiem_{day}', 0) or 0)
                                
                                if amount > 0:
                                    daily_amounts.append((day.capitalize(), amount))
                                    daily_total += amount
                            
                            if daily_total > 0:
                                c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Per Diem")
                                c.drawRightString(5.5 * inch, y, f"${daily_total:.2f}")
                                y -= 12
                                
                                # Add daily breakdown for this relationship
                                c.setFont("Helvetica", 8)
                                for day, amount in daily_amounts:
                                    c.drawString(left + 12, y, f"• {day}: ${amount:.2f}")
                                    y -= 10
                                
                                c.setFont("Helvetica", 9)
                                y -= 2
                        elif perdiem_amount > 0:
                            # Use per diem total amount (no daily breakdown)
                            c.drawString(left, y, f"{rel.get('clientName', 'Unknown')} - Per Diem")
                            c.drawRightString(5.5 * inch, y, f"${perdiem_amount:.2f}")
                            y -= 12

            c.drawString(left, y, "Total Amount")
            c.drawRightString(5.5 * inch, y, f"${check.amount:,.2f}")
            y -= 18

            # === Additional Info (Optional)
            c.setFont("Helvetica-Oblique", 8)
            # Handle created_by as either string or object
            print(f"🔍 PDF DEBUG: check.created_by = {check.created_by}")
            print(f"🔍 PDF DEBUG: type(check.created_by) = {type(check.created_by)}")
            created_by = check.created_by.username if hasattr(check.created_by, 'username') else (check.created_by or "Unknown")
            
            # Try to get better user information
            if created_by == "Unknown" and hasattr(check, 'created_by'):
                # Check if created_by has email or other identifying info
                if hasattr(check.created_by, 'email'):
                    created_by = check.created_by.email
                elif hasattr(check.created_by, 'name'):
                    created_by = check.created_by.name
                elif hasattr(check.created_by, 'displayName'):
                    created_by = check.created_by.displayName
            
            print(f"🔍 PDF DEBUG: Final created_by = {created_by}")
            date_str = check.date.strftime('%Y-%m-%d') if check.date else "N/A"
            c.drawString(left, y, f"Check #{check.check_number} created by {created_by} on {date_str}")
            print(f"🔍 PDF DEBUG: Drew creator line at y={y}: Check #{check.check_number} created by {created_by} on {date_str}")





    # Top: Full check
    draw_section(y_offset=2 * section_height, top_section=True)

    # Middle: Payment stub with breakdown
    draw_section(y_offset=1 * section_height, middle_section=True)

    # Bottom: Payment stub (duplicate for employee records)
    draw_section(y_offset=0, bottom_section=True)

    c.save()
    buffer.seek(0)
    return buffer.getvalue()