-- Employee IDs are unique per dealer regardless of upper/lower case.
create unique index people_dealer_code_ci on people (dealer_id, lower(employee_code));
