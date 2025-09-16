from flask import request, send_file, jsonify
from io import BytesIO
from PyPDF2 import PdfMerger
from datetime import datetime, timedelta
from pdf_generator import generate_clean_check

def configure_routes(app, firestore_db):

    @app.route("/api/print_week", methods=["GET"])
    def print_week():
        try:
            company_id = request.args.get("companyId")
            week_key = request.args.get("weekKey")

            if not company_id or not week_key:
                return jsonify({"error": "Missing parameters"}), 400

            print(f"DEBUG: week_key received: {week_key!r}")
            try:
                start_date = datetime.strptime(week_key, "%Y-%m-%d")
            except Exception as e:
                print(f"ERROR: Failed to parse week_key: {week_key!r}")
                return jsonify({"error": f"Invalid weekKey: {week_key!r}. Must be in format YYYY-MM-DD."}), 400
            end_date = start_date + timedelta(days=6)

            # Query Firestore for checks in that week and company
            checks_query = (
                firestore_db.collection("checks")
                .where("companyId", "==", company_id)
                .where("date", ">=", start_date)
                .where("date", "<=", end_date)
            )
            check_docs = list(checks_query.stream())
            if not check_docs:
                return jsonify({"error": "No checks found"}), 404

            # get company info
            company_doc = firestore_db.collection("companies").document(company_id).get()
            company_data = company_doc.to_dict() if company_doc.exists else {}

            class Company:
                def __init__(self, data):
                    self.name = data.get("name", "")
                    self.address = data.get("address", "")
                    self.logo = data.get("logoBase64", "")
                    print(f"🏢 Company {self.name} logo data: {'Present' if self.logo else 'Missing'}")
                    if self.logo:
                        print(f"📏 Logo data length: {len(self.logo)}")
                        print(f"🔍 Logo data starts with: {self.logo[:50]}...")

            company = Company(company_data)

            # get bank info
            bank_query = firestore_db.collection("banks").where("companyId", "==", company_id).limit(1).stream()
            bank_data = {}
            for b in bank_query:
                bank_data = b.to_dict()
                break

            class Bank:
                def __init__(self, data):
                    self.name = data.get("bankName", "")
                    self.routing_number = data.get("routingNumber", "")
                    self.account_number = data.get("accountNumber", "")

            bank = Bank(bank_data)

            # Build check objects
            check_objects = []
            for doc in check_docs:
                d = doc.to_dict()
                print(f"🔍 DEBUG: Check data from Firestore: {d}")
                print(f"🔍 DEBUG: Check fields: {list(d.keys())}")
                print(f"🔍 DEBUG: Per diem fields in data:")
                print(f"  - perdiemAmount: {d.get('perdiemAmount')}")
                print(f"  - perdiemBreakdown: {d.get('perdiemBreakdown')}")
                print(f"  - perdiemMonday: {d.get('perdiemMonday')}")
                print(f"  - perdiemTuesday: {d.get('perdiemTuesday')}")
                print(f"  - perdiemWednesday: {d.get('perdiemWednesday')}")
                print(f"  - perdiemThursday: {d.get('perdiemThursday')}")
                print(f"  - perdiemFriday: {d.get('perdiemFriday')}")
                print(f"  - perdiemSaturday: {d.get('perdiemSaturday')}")
                print(f"  - perdiemSunday: {d.get('perdiemSunday')}")
                emp_id = d.get("employeeId")
                emp_name = d.get("employeeName", "")
                if emp_id and not emp_name:
                    emp_doc = firestore_db.collection("employees").document(emp_id).get()
                    if emp_doc.exists:
                        emp_data = emp_doc.to_dict()
                        emp_name = emp_data.get("name", "")

                # Get creator username - check multiple possible field names
                created_by = d.get("madeByName") or d.get("createdByUserName") or d.get("created_by")
                # If we only have a creator ID, look up the username
                if not created_by and d.get("createdBy"):
                    u_doc = firestore_db.collection("users").document(d.get("createdBy")).get()
                    if u_doc.exists:
                        u_data = u_doc.to_dict()
                        created_by = u_data.get("username", "Unknown")

                class Employee:
                    def __init__(self, name):
                        self.name = name

                class Check:
                    def __init__(self, d, company, bank, emp_name, created_by):
                        self.company = company
                        self.bank = bank
                        self.employee = Employee(emp_name)
                        self.check_number = int(d.get("checkNumber", 1001))
                        self.amount = float(d.get("amount", 0))
                        # Firestore timestamp to datetime
                        raw_date = d.get("date")
                        if hasattr(raw_date, "to_datetime"):
                            self.date = raw_date.to_datetime()
                        elif isinstance(raw_date, datetime):
                            self.date = raw_date
                        else:
                            self.date = start_date
                        self.memo = d.get("memo", "")
                        self.work_week = d.get("workWeek", "")
                        # Fix field mapping to match frontend field names
                        self.hours_worked = d.get("hours")
                        self.pay_rate = d.get("payRate")
                        self.overtime_hours = d.get("otHours")
                        self.overtime_rate = float(d.get("payRate", 0)) * 1.5  # OT is 1.5x base rate
                        self.holiday_hours = d.get("holidayHours")
                        self.holiday_rate = float(d.get("payRate", 0)) * 2  # Holiday is 2x base rate
                        self.perdiem_amount = d.get("perdiemAmount", 0)  # ✅ Add per diem amount
                        self.perdiem_breakdown = d.get("perdiemBreakdown", False)  # ✅ Add per diem breakdown flag
                        self.perdiem_monday = d.get("perdiemMonday", 0)  # ✅ Add daily breakdown
                        self.perdiem_tuesday = d.get("perdiemTuesday", 0)
                        self.perdiem_wednesday = d.get("perdiemWednesday", 0)
                        self.perdiem_thursday = d.get("perdiemThursday", 0)
                        self.perdiem_friday = d.get("perdiemFriday", 0)
                        self.perdiem_saturday = d.get("perdiemSaturday", 0)
                        self.perdiem_sunday = d.get("perdiemSunday", 0)
                        self.client = None
                        # ✅ Add relationship details for client information
                        self.relationshipDetails = d.get("relationshipDetails", [])
                        # ✅ Add relationship hours for accurate PDF breakdown
                        self.relationshipHours = d.get("relationshipHours", {})
                        # ✅ pass through created_by
                        self.created_by = created_by

                check_obj = Check(d, company, bank, emp_name, created_by)
                print(f"🔍 Check data for {emp_name}: hours={check_obj.hours_worked}, pay_rate={check_obj.pay_rate}, ot_hours={check_obj.overtime_hours}, holiday_hours={check_obj.holiday_hours}")
                print(f"🔍 Check relationshipHours: {getattr(check_obj, 'relationshipHours', 'NOT_FOUND')}")
                print(f"🔍 Check relationshipDetails: {getattr(check_obj, 'relationshipDetails', 'NOT_FOUND')}")
                check_objects.append(check_obj)

            # Merge PDFs
            merger = PdfMerger()
            for check in check_objects:
                pdf_data = generate_clean_check(check)
                merger.append(BytesIO(pdf_data))

            output = BytesIO()
            merger.write(output)
            merger.close()
            output.seek(0)

            return send_file(
                output,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=f"checks_{week_key}.pdf",
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @app.route("/api/print_reviewed_checks", methods=["GET"])
    def print_reviewed_checks():
        try:
            company_id = request.args.get("companyId")
            week_key = request.args.get("weekKey")
            if not company_id or not week_key:
                return jsonify({"error": "Missing parameters"}), 400
            print(f"DEBUG: week_key received: {week_key!r}")
            try:
                start_date = datetime.strptime(week_key, "%Y-%m-%d")
            except Exception as e:
                print(f"ERROR: Failed to parse week_key: {week_key!r}")
                return jsonify({"error": f"Invalid weekKey: {week_key!r}. Must be in format YYYY-MM-DD."}), 400
            end_date = start_date + timedelta(days=6)
            # Query Firestore for reviewed checks in that week and company
            checks_query = (
                firestore_db.collection("checks")
                .where("companyId", "==", company_id)
                .where("date", ">=", start_date)
                .where("date", "<=", end_date)
                .where("reviewed", "==", True)
            )
            check_docs = list(checks_query.stream())
            if not check_docs:
                return jsonify({"error": "No reviewed checks found"}), 404
            # get company info
            company_doc = firestore_db.collection("companies").document(company_id).get()
            company_data = company_doc.to_dict() if company_doc.exists else {}
            class Company:
                def __init__(self, data):
                    self.name = data.get("name", "")
                    self.address = data.get("address", "")
                    self.logo = data.get("logoBase64", "")
                    print(f"🏢 Company {self.name} logo data: {'Present' if self.logo else 'Missing'}")
                    if self.logo:
                        print(f"📏 Logo data length: {len(self.logo)}")
                        print(f"🔍 Logo data starts with: {self.logo[:50]}...")
            company = Company(company_data)
            # get bank info
            bank_query = firestore_db.collection("banks").where("companyId", "==", company_id).limit(1).stream()
            bank_data = {}
            for b in bank_query:
                bank_data = b.to_dict()
                break
            class Bank:
                def __init__(self, data):
                    self.name = data.get("bankName", "")
                    self.routing_number = data.get("routingNumber", "")
                    self.account_number = data.get("accountNumber", "")
            bank = Bank(bank_data)
            # Build check objects
            check_objects = []
            for doc in check_docs:
                d = doc.to_dict()
                print(f"🔍 DEBUG: Check data from Firestore: {d}")
                print(f"🔍 DEBUG: Check fields: {list(d.keys())}")
                print(f"🔍 DEBUG: Per diem fields in data:")
                print(f"  - perdiemAmount: {d.get('perdiemAmount')}")
                print(f"  - perdiemBreakdown: {d.get('perdiemBreakdown')}")
                print(f"  - perdiemMonday: {d.get('perdiemMonday')}")
                print(f"  - perdiemTuesday: {d.get('perdiemTuesday')}")
                print(f"  - perdiemWednesday: {d.get('perdiemWednesday')}")
                print(f"  - perdiemThursday: {d.get('perdiemThursday')}")
                print(f"  - perdiemFriday: {d.get('perdiemFriday')}")
                print(f"  - perdiemSaturday: {d.get('perdiemSaturday')}")
                print(f"  - perdiemSunday: {d.get('perdiemSunday')}")
                emp_id = d.get("employeeId")
                emp_name = d.get("employeeName", "")
                if emp_id and not emp_name:
                    emp_doc = firestore_db.collection("employees").document(emp_id).get()
                    if emp_doc.exists:
                        emp_data = emp_doc.to_dict()
                        emp_name = emp_data.get("name", "")
                created_by = d.get("madeByName") or d.get("createdByUserName") or d.get("created_by")
                if not created_by and d.get("createdBy"):
                    u_doc = firestore_db.collection("users").document(d.get("createdBy")).get()
                    if u_doc.exists:
                        u_data = u_doc.to_dict()
                        created_by = u_data.get("username", "Unknown")
                class Employee:
                    def __init__(self, name):
                        self.name = name
                class Check:
                    def __init__(self, d, company, bank, emp_name, created_by):
                        self.company = company
                        self.bank = bank
                        self.employee = Employee(emp_name)
                        self.check_number = int(d.get("checkNumber", 1001))
                        self.amount = float(d.get("amount", 0))
                        raw_date = d.get("date")
                        if hasattr(raw_date, "to_datetime"):
                            self.date = raw_date.to_datetime()
                        elif isinstance(raw_date, datetime):
                            self.date = raw_date
                        else:
                            self.date = start_date
                        self.memo = d.get("memo", "")
                        self.work_week = d.get("workWeek", "")
                        self.hours_worked = d.get("hours")
                        self.pay_rate = d.get("payRate")
                        self.overtime_hours = d.get("otHours")
                        self.overtime_rate = float(str(d.get("payRate", 0))) * 1.5
                        self.holiday_hours = d.get("holidayHours")
                        self.holiday_rate = float(str(d.get("payRate", 0))) * 2
                        self.perdiem_amount = d.get("perdiemAmount", 0)  # ✅ Add per diem amount
                        self.perdiem_breakdown = d.get("perdiemBreakdown", False)  # ✅ Add per diem breakdown flag
                        self.perdiem_monday = d.get("perdiemMonday", 0)  # ✅ Add daily breakdown
                        self.perdiem_tuesday = d.get("perdiemTuesday", 0)
                        self.perdiem_wednesday = d.get("perdiemWednesday", 0)
                        self.perdiem_thursday = d.get("perdiemThursday", 0)
                        self.perdiem_friday = d.get("perdiemFriday", 0)
                        self.perdiem_saturday = d.get("perdiemSaturday", 0)
                        self.perdiem_sunday = d.get("perdiemSunday", 0)
                        self.client = None
                        # ✅ Add relationship details for client information
                        self.relationshipDetails = d.get("relationshipDetails", [])
                        # ✅ Add relationship hours for accurate PDF breakdown
                        self.relationshipHours = d.get("relationshipHours", {})
                        self.created_by = created_by
                check_obj = Check(d, company, bank, emp_name, created_by)
                check_objects.append(check_obj)
            # Merge PDFs
            merger = PdfMerger()
            for check in check_objects:
                pdf_data = generate_clean_check(check)
                merger.append(BytesIO(pdf_data))
            output = BytesIO()
            merger.write(output)
            merger.close()
            output.seek(0)
            return send_file(
                output,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=f"reviewed_checks_{week_key}.pdf",
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @app.route("/api/print_selected_checks", methods=["POST"])
    def print_selected_checks():
        try:
            data = request.get_json()
            check_ids = data.get("checkIds")
            if not check_ids or not isinstance(check_ids, list):
                return jsonify({"error": "Missing or invalid checkIds"}), 400
            # Fetch all checks by ID
            check_docs = [firestore_db.collection("checks").document(cid).get() for cid in check_ids]
            check_docs = [doc for doc in check_docs if doc.exists]
            if not check_docs:
                return jsonify({"error": "No checks found for provided IDs"}), 404
            # Use the companyId from the first check
            first_check = check_docs[0].to_dict()
            company_id = first_check.get("companyId")
            week_key = data.get("weekKey")
            # get company info
            company_doc = firestore_db.collection("companies").document(company_id).get()
            company_data = company_doc.to_dict() if company_doc.exists else {}
            class Company:
                def __init__(self, data):
                    self.name = data.get("name", "")
                    self.address = data.get("address", "")
                    self.logo = data.get("logoBase64", "")
            company = Company(company_data)
            # get bank info
            bank_query = firestore_db.collection("banks").where("companyId", "==", company_id).limit(1).stream()
            bank_data = {}
            for b in bank_query:
                bank_data = b.to_dict()
                break
            class Bank:
                def __init__(self, data):
                    self.name = data.get("bankName", "")
                    self.routing_number = data.get("routingNumber", "")
                    self.account_number = data.get("accountNumber", "")
            bank = Bank(bank_data)
            # Build check objects
            check_objects = []
            for doc in check_docs:
                d = doc.to_dict()
                print(f"🔍 DEBUG: Check data from Firestore: {d}")
                print(f"🔍 DEBUG: Check fields: {list(d.keys())}")
                print(f"🔍 DEBUG: Relationship Details: {d.get('relationshipDetails')}")
                print(f"🔍 DEBUG: Hours worked: {d.get('hours')}")
                print(f"🔍 DEBUG: Pay rate: {d.get('payRate')}")
                print(f"🔍 DEBUG: Per diem fields in data:")
                print(f"  - perdiemAmount: {d.get('perdiemAmount')}")
                print(f"  - perdiemBreakdown: {d.get('perdiemBreakdown')}")
                print(f"  - perdiemMonday: {d.get('perdiemMonday')}")
                print(f"  - perdiemTuesday: {d.get('perdiemTuesday')}")
                print(f"  - perdiemWednesday: {d.get('perdiemWednesday')}")
                print(f"  - perdiemThursday: {d.get('perdiemThursday')}")
                print(f"  - perdiemFriday: {d.get('perdiemFriday')}")
                print(f"  - perdiemSaturday: {d.get('perdiemSaturday')}")
                print(f"  - perdiemSunday: {d.get('perdiemSunday')}")
                emp_id = d.get("employeeId")
                emp_name = d.get("employeeName", "")
                if emp_id and not emp_name:
                    emp_doc = firestore_db.collection("employees").document(emp_id).get()
                    if emp_doc.exists:
                        emp_data = emp_doc.to_dict()
                        emp_name = emp_data.get("name", "")
                print(f"🔍 DEBUG: createdBy from data: {d.get('createdBy')}")
                created_by = d.get("madeByName") or d.get("createdByUserName") or d.get("created_by")
                if not created_by and d.get("createdBy"):
                    print(f"🔍 DEBUG: Looking up user info for createdBy: {d.get('createdBy')}")
                    u_doc = firestore_db.collection("users").document(d.get("createdBy")).get()
                    if u_doc.exists:
                        u_data = u_doc.to_dict()
                        print(f"🔍 DEBUG: User data found: {list(u_data.keys())}")
                        # Try multiple possible name fields
                        created_by = (u_data.get("username") or 
                                    u_data.get("name") or 
                                    u_data.get("displayName") or 
                                    u_data.get("email") or 
                                    "Unknown")
                        print(f"🔍 DEBUG: Using creator name: {created_by}")
                    else:
                        print(f"🔍 DEBUG: User document not found for ID: {d.get('createdBy')}")
                        created_by = "Unknown"
                class Employee:
                    def __init__(self, name):
                        self.name = name
                class Check:
                    def __init__(self, d, company, bank, emp_name, created_by):
                        self.company = company
                        self.bank = bank
                        self.employee = Employee(emp_name)
                        self.check_number = int(d.get("checkNumber", 1001))
                        self.amount = float(d.get("amount", 0))
                        raw_date = d.get("date")
                        if hasattr(raw_date, "to_datetime"):
                            self.date = raw_date.to_datetime()
                        elif isinstance(raw_date, datetime):
                            self.date = raw_date
                        else:
                            self.date = None
                        self.memo = d.get("memo", "")
                        self.work_week = d.get("workWeek", "")
                        self.hours_worked = d.get("hours")
                        self.pay_rate = d.get("payRate")
                        self.overtime_hours = d.get("otHours")
                        self.overtime_rate = float(str(d.get("payRate", 0))) * 1.5
                        self.holiday_hours = d.get("holidayHours")
                        self.holiday_rate = float(str(d.get("payRate", 0))) * 2
                        self.perdiem_amount = d.get("perdiemAmount", 0)  # ✅ Add per diem amount
                        self.perdiem_breakdown = d.get("perdiemBreakdown", False)  # ✅ Add per diem breakdown flag
                        self.perdiem_monday = d.get("perdiemMonday", 0)  # ✅ Add daily breakdown
                        self.perdiem_tuesday = d.get("perdiemTuesday", 0)
                        self.perdiem_wednesday = d.get("perdiemWednesday", 0)
                        self.perdiem_thursday = d.get("perdiemThursday", 0)
                        self.perdiem_friday = d.get("perdiemFriday", 0)
                        self.perdiem_saturday = d.get("perdiemSaturday", 0)
                        self.perdiem_sunday = d.get("perdiemSunday", 0)
                        self.client = None
                        self.relationshipDetails = d.get("relationshipDetails", [])  # ✅ Add relationship details
                        # ✅ Add relationship hours for accurate PDF breakdown
                        self.relationshipHours = d.get("relationshipHours", {})
                        self.created_by = created_by
                        
                        # ✅ Dynamically set all relationship-specific fields as attributes
                        # This allows the PDF generator to find fields like "1754920623462_hours", "1754920628238_perdiemAmount", etc.
                        for key, value in d.items():
                            if '_hours' in key or '_perdiem' in key or '_otHours' in key or '_holidayHours' in key:
                                setattr(self, key, value)
                                print(f"🔍 DEBUG: Set relationship-specific attribute: {key} = {value}")
                check_obj = Check(d, company, bank, emp_name, created_by)
                check_objects.append(check_obj)
            # Merge PDFs
            merger = PdfMerger()
            for check in check_objects:
                pdf_data = generate_clean_check(check)
                merger.append(BytesIO(pdf_data))
            output = BytesIO()
            merger.write(output)
            merger.close()
            output.seek(0)
            return send_file(
                output,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=f"selected_checks_{week_key or 'checks'}.pdf",
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500
