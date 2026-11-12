import { Component } from '@angular/core';

@Component({
  selector: 'app-signup-form',
  templateUrl: './signup-form.component.html',
})
export class SignupFormComponent {
  name = '';
  email = '';
  password = '';
  terms = false;
  submitted = false;

  onTerms(value: boolean) {
    this.terms = value;
  }

  save() {
    this.submitted = true;
  }
}
